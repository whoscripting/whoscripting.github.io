const sourceInput = document.getElementById('sourceInput');
const outputBox = document.getElementById('outputBox');
const notesList = document.getElementById('notesList');
const templateTab = document.getElementById('templateTab');
const moduleTab = document.getElementById('moduleTab');
const copyButton = document.getElementById('copyButton');

let currentMode = 'template';

const sample = '<infobox>\n  <title source="title1">\n    <default>{{PAGENAME}}</default>\n  </title>\n  <image source="image1">\n    <default>Placeholder.png</default>\n  </image>\n  <data source="parameter">\n    <label>Parameter</label>\n  </data>\n</infobox>';

function cleanText(value) {
	return (value || '')
		.replace(/\r/g, '')
		.replace(/\n[ \t]+/g, '\n')
		.replace(/[ \t]+\n/g, '\n')
		.trim();
}

function attrValue(tag, name) {
	const pattern = new RegExp(name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^\\s>/]+))', 'i');
	const match = tag.match(pattern);
	return match ? cleanText(match[2] || match[3] || match[4] || '') : '';
}

function stripTags(value) {
	return cleanText(value.replace(/<[^>]+>/g, ''));
}

function readComments(value) {
	var matches = (value || '').match(/<!--[\s\S]*?-->/g);
	return matches ? matches.map(function(m) { return m.trim(); }) : [];
}

function childContent(block, tagName) {
	const match = block.match(new RegExp('<' + tagName + '\\b[^>]*>([\\s\\S]*?)<\\/' + tagName + '>', 'i'));
	if (match) return cleanText(match[1]);
	const selfClosing = block.match(new RegExp('<' + tagName + '\\b([^>]*)\\/>', 'i'));
	if (selfClosing) return '';
	return '';
}

function childAttr(block, tagName, name) {
	const match = block.match(new RegExp('<' + tagName + '\\b([^>]*)>', 'i'));
	return match ? attrValue(match[0], name) : '';
}

function topLevelInner(input) {
	const match = input.match(/<infobox\b[^>]*>([\s\S]*?)<\/infobox>/i);
	return match ? match[1] : input;
}

function infoboxOuterBounds(input) {
	const match = input.match(/<infobox\b[^>]*>[\s\S]*?<\/infobox>/i);
	return match ? { start: match.index, end: match.index + match[0].length } : null;
}

function includeOnlyInner(input) {
	const match = input.match(/<includeonly\b[^>]*>([\s\S]*?)<\/includeonly>/i);
	return match ? match[1] : input;
}

function noIncludeInner(input) {
	const match = input.match(/<noinclude\b[^>]*>([\s\S]*?)<\/noinclude>/i);
	return match ? match[1] : '';
}

function readBlocks(markup) {
	const blocks = [];
	const tokenPattern = /<(title|image|header|data|group|panel|section|label)\b[^>]*(?:\/>|>)/ig;
	let match;

	while ((match = tokenPattern.exec(markup)) !== null) {
		const tagName = match[1].toLowerCase();
		const openTag = match[0];
		const start = match.index;

		if (openTag.endsWith('/>')) {
			blocks.push({ tagName: tagName, openTag: openTag, body: '', full: openTag, start: start });
			continue;
		}

		const closePattern = new RegExp('</' + tagName + '>', 'ig');
		closePattern.lastIndex = tokenPattern.lastIndex;
		const close = closePattern.exec(markup);
		if (!close) {
			blocks.push({ tagName: tagName, openTag: openTag, body: '', full: openTag, start: start });
			continue;
		}

		const body = markup.slice(tokenPattern.lastIndex, close.index);
		const full = markup.slice(start, close.index + close[0].length);
		blocks.push({ tagName: tagName, openTag: openTag, body: body, full: full, start: start });
		tokenPattern.lastIndex = close.index + close[0].length;
	}

	return blocks;
}

function wikitextParam(source, fallback) {
	if (!source) return fallback || '';
	return '{{{' + source + '|' + (fallback || '') + '}}}';
}

function luaArg(source, fallback) {
	if (!source) {
		if (fallback && fallback.startsWith('(') && fallback.includes('or')) {
			return fallback;
		}
		return luaString(fallback ? fallback.replace(/^''$/, '') : '');
	}
	let defaultValue = '';
	if (fallback && fallback !== "''") {
		if (fallback.startsWith('(') && fallback.includes('or')) {
			defaultValue = ' or ' + fallback;
		} else {
			defaultValue = ' or ' + luaString(fallback);
		}
	}
	return 'args[' + luaString(source) + ']' + defaultValue;
}

function luaString(value) {
	return "'" + String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n') + "'";
}

function parseBlocks(markup, notes) {
	const blocks = readBlocks(markup);
	const rows = [];
	for (var i = 0; i < blocks.length; i++) {
		const block = blocks[i];
		const tagName = block.tagName;
		if (tagName === 'title') {
			rows.push({
				type: 'title',
				source: attrValue(block.openTag, 'source'),
				defaultValue: stripTags(childContent(block.full, 'default')),
				comments: readComments(block.full)
			});
		} else if (tagName === 'image') {
			rows.push({
				type: 'image',
				source: attrValue(block.openTag, 'source') || 'image',
				captionSource: childAttr(block.full, 'caption', 'source'),
				captionDefault: stripTags(childContent(block.full, 'caption')),
				defaultValue: stripTags(childContent(block.full, 'default')),
				comments: readComments(block.full)
			});
		} else if (tagName === 'header') {
			rows.push({
				type: 'header',
				label: stripTags(block.body),
				source: attrValue(block.openTag, 'source'),
				defaultValue: stripTags(childContent(block.full, 'default')),
				comments: readComments(block.full)
			});
		} else if (tagName === 'data') {
			rows.push(readDataBlock(block));
		} else if (tagName === 'label') {
			rows.push({
				type: 'label',
				body: stripTags(block.body)
			});
		} else if (tagName === 'group' || tagName === 'section') {
			const children = parseBlocks(block.body, notes);
			const labelRow = children.find(function(r) { return r.type === 'label'; });
			const label = labelRow ? labelRow.body : '';
			rows.push({
				type: 'section',
				label: label,
				rows: children.filter(function(r) { return r.type !== 'label'; })
			});
			if (tagName === 'group' && /layout\s*=\s*["']?horizontal/i.test(block.openTag)) {
				notes.push('Horizontal groups are preserved as a section, but exact PortableInfobox mobile layout cannot be inferred.');
			}
		} else if (tagName === 'panel') {
			const sections = [];
			const subBlocks = readBlocks(block.body);
			let tabIndex = 1;
			for (var j = 0; j < subBlocks.length; j++) {
				const sub = subBlocks[j];
				if (sub.tagName === 'section') {
					const children = parseBlocks(sub.body, notes);
					const labelRow = children.find(function(r) { return r.type === 'label'; });
					const label = labelRow ? labelRow.body : '';
					sections.push({
						label: label || ('Tab ' + tabIndex++),
						rows: children.filter(function(r) { return r.type !== 'label'; })
					});
				} else {
					const nonSectionRows = parseBlocks(sub.body || sub.full, notes);
					if (nonSectionRows.length) {
						sections.push({
							label: 'Tab ' + tabIndex++,
							rows: nonSectionRows
						});
					}
				}
			}
			rows.push({
				type: 'panel',
				sections: sections
			});
		}
	}
	return rows;
}

function parsePortableInfobox(input) {
	const notes = [];
	const sourceBody = includeOnlyInner(input);
	const inner = topLevelInner(sourceBody);
	const rows = parseBlocks(inner, notes);
	const bounds = infoboxOuterBounds(sourceBody);
	const noinclude = noIncludeInner(input);
	const noincludeContent = cleanText(noinclude);

	let title = null;
	let image = null;
	for (var i = 0; i < rows.length; i++) {
		if (rows[i].type === 'title' && !title) title = rows[i];
		if (rows[i].type === 'image' && !image) image = rows[i];
	}

	const model = {
		title: title,
		image: image,
		rows: rows.filter(function(r) { return r !== title && r !== image; }),
		leadingComments: readLeadingComments(input),
		includePrelude: bounds ? cleanText(sourceBody.slice(0, bounds.start)) : '',
		includePostlude: bounds ? cleanText(sourceBody.slice(bounds.end)) : '',
		hasIncludeOnly: /<includeonly\b/i.test(input),
		hasNoInclude: /<noinclude\b/i.test(input),
		noincludeContent: noincludeContent,
		rawBlockCount: rows.length
	};

	if (!input.trim()) {
		notes.push('Paste a PortableInfobox template to begin.');
		return { model: model, notes: notes };
	}

	if (!/<infobox\b/i.test(input)) {
		notes.push('No <infobox> wrapper was found, so the whole input was treated as infobox contents.');
	}

	if (!model.title) notes.push('No title tag was found. The generated output falls back to the page title.');
	if (!model.image) notes.push('No image tag was found. You can add one manually if the target infobox needs it.');
	if (model.image && (model.image.captionSource || model.image.captionDefault)) {
		notes.push('InfoboxNeue fromArgs/renderImage does not expose an image caption slot in the documented Star Citizen/Dovedale version.');
	}
	if (!model.rows.length) notes.push('No data rows were found.');
	if (/<(?:navigation|audio|video)\b/i.test(input)) {
		notes.push('Some specialized PortableInfobox tags were detected and are not converted automatically.');
	}
	if (model.rows.some(function(r) { return r.type === 'panel'; })) {
		notes.push('Panels are converted to tabbers for Module output, but are ignored in Template output.');
	}
	if (model.leadingComments.length) notes.push('Template comments were preserved in the generated output.');
	if (model.includePrelude || model.includePostlude) notes.push('Wikitext outside the infobox was preserved inside includeonly output.');
	if (model.noincludeContent) notes.push('Noinclude content was preserved because it existed in the source.');

	return { model: model, notes: notes };
}

function readLeadingComments(input) {
	const comments = [];
	const pattern = /^\s*(<!--[\s\S]*?-->)/;
	let rest = input;
	let match = rest.match(pattern);

	while (match) {
		comments.push(match[1].trim());
		rest = rest.slice(match[0].length);
		match = rest.match(pattern);
	}

	return comments;
}

function readDataBlock(block) {
	return {
		type: 'data',
		source: attrValue(block.openTag, 'source'),
		label: stripTags(childContent(block.full, 'label')),
		defaultValue: stripTags(childContent(block.full, 'default')),
		formatValue: cleanText(childContent(block.full, 'format')),
		comments: readComments(block.full)
	};
}

function makeTemplateOutput(model) {
	const lines = [];
	const titleSource = model.title ? model.title.source : 'title';
	const titleFallback = (model.title && model.title.defaultValue) ? model.title.defaultValue : '{{PAGENAME}}';
	let sectionIndex = 1;
	let itemIndex = 1;

	for (var i = 0; i < model.leadingComments.length; i++) lines.push(model.leadingComments[i]);
	if (model.leadingComments.length) lines.push('');
	if (model.hasIncludeOnly) lines.push('<includeonly>');
	if (model.includePrelude) lines.push(model.includePrelude);
	lines.push('{{InfoboxNeue');
	lines.push('| title = ' + wikitextParam(titleSource, titleFallback));

	if (model.image) {
		const imgComments = prefixComments(model.image.comments);
		for (var k = 0; k < imgComments.length; k++) lines.push(imgComments[k]);
		lines.push('| image = ' + wikitextParam(model.image.source, model.image.defaultValue));
	}

	function renderRows(rows) {
		for (var m = 0; m < rows.length; m++) {
			const entry = rows[m];
			if (entry.type === 'panel') continue;
			if (entry.type === 'section') {
				if (entry.label) {
					lines.push('| section' + sectionIndex + ' = ' + entry.label);
					sectionIndex += 1;
				}
				renderRows(entry.rows);
			} else if (entry.type === 'header') {
				const hdrComments = prefixComments(entry.comments);
				for (var n = 0; n < hdrComments.length; n++) lines.push(hdrComments[n]);
				lines.push('| section' + sectionIndex + ' = ' + (entry.label || wikitextParam(entry.source, entry.defaultValue)));
				sectionIndex += 1;
			} else if (entry.type === 'data') {
				const dataComments = prefixComments(entry.comments);
				for (var p = 0; p < dataComments.length; p++) lines.push(dataComments[p]);
				lines.push('| label' + itemIndex + ' = ' + (entry.label || titleCase(entry.source)));
				lines.push('| content' + itemIndex + ' = ' + templateContent(entry));
				itemIndex += 1;
			}
		}
	}

	renderRows(model.rows);

	lines.push('}}');
	if (model.includePostlude) lines.push(model.includePostlude);
	if (model.hasIncludeOnly) lines.push('</includeonly>');
	if (model.hasNoInclude && model.noincludeContent) {
		lines.push('<noinclude>');
		lines.push(model.noincludeContent);
		lines.push('</noinclude>');
	}
	return lines.join('\n');
}

function prefixComments(comments) {
	return comments || [];
}

function templateContent(row) {
	return row.formatValue || wikitextParam(row.source, row.defaultValue);
}

function makeModuleOutput(model) {
	const hasPanel = model.rows.some(function(r) { return r.type === 'panel'; });
	const lines = [
		'local p = {}',
		'',
		"local getArgs = require('Module:Arguments').getArgs",
		"local InfoboxNeue = require('Module:InfoboxNeue')"
	];

	if (hasPanel) {
		lines.push("local tabber = require('Module:Tabber').renderTabber");
	}

	lines.push(
		'',
		'function p.main(frame)',
		'    local args = getArgs(frame)',
		'    local infobox = InfoboxNeue:new()',
		''
	);

	if (model.image) {
		const imgComments = luaComments(model.image.comments, '    ');
		for (var i = 0; i < imgComments.length; i++) lines.push(imgComments[i]);
		lines.push('    infobox:renderImage(' + luaArg(model.image.source, model.image.defaultValue) + ')');
		lines.push('');
	}

	const titleSource = model.title ? model.title.source : 'title';
	const titleFallback = (model.title && model.title.defaultValue) ? model.title.defaultValue : "((mw and mw.title.getCurrentTitle().text) or 'Page Title')";
	const titleComments = luaComments(model.title ? model.title.comments : [], '    ');
	for (var j = 0; j < titleComments.length; j++) lines.push(titleComments[j]);
	lines.push('    infobox:renderHeader({');
	lines.push('        title = ' + luaArg(titleSource, titleFallback));
	lines.push('    })');

	const moduleSections = makeModuleSections(model.rows);
	for (var k = 0; k < moduleSections.length; k++) {
		const section = moduleSections[k];
		if (section.type === 'panel') {
			renderLuaPanel(lines, section);
		} else {
			renderLuaSection(lines, section);
		}
	}

	lines.push('');
	lines.push('    return tostring(infobox)');
	lines.push('end');
	lines.push('');
	lines.push('return p');
	return lines.join('\n');
}

function makeModuleSections(rows) {
	const sections = [];
	let current = { label: '', rows: [] };

	for (var i = 0; i < rows.length; i++) {
		const row = rows[i];
		if (row.type === 'panel' || row.type === 'section') {
			if (current.rows.length || current.label) sections.push(current);
			sections.push(row);
			current = { label: '', rows: [] };
		} else if (row.type === 'header') {
			if (current.rows.length || current.label) sections.push(current);
			current = { label: row.label || row.defaultValue || '', rows: [] };
		} else {
			current.rows.push(row);
		}
	}

	if (current.rows.length || current.label) sections.push(current);
	return sections;
}

function renderLuaSection(lines, section) {
	if (section.type === 'section') {
		lines.push('');
		lines.push('    do');
		lines.push('        local sectionRows = {}');
		renderLuaRows(lines, section.rows, 'sectionRows');
		lines.push('        infobox:renderSection({');
		if (section.label) lines.push('            title = ' + luaString(section.label) + ',');
		lines.push('            content = table.concat(sectionRows)');
		lines.push('        })');
		lines.push('    end');
		return;
	}

	const label = section.label || '';
	lines.push('');
	lines.push('    do');
	lines.push('        local sectionRows = {}');
	renderLuaRows(lines, section.rows, 'sectionRows');
	lines.push('        infobox:renderSection({');
	if (label) lines.push('            title = ' + luaString(label) + ',');
	lines.push('            content = table.concat(sectionRows)');
	lines.push('        })');
	lines.push('    end');
}

function renderLuaRows(lines, rows, tableVar) {
	for (var i = 0; i < rows.length; i++) {
		const row = rows[i];
		if (row.type === 'data') {
			const dataComments = luaComments(row.comments, '        ');
			for (var j = 0; j < dataComments.length; j++) lines.push(dataComments[j]);
			lines.push('        table.insert(' + tableVar + ', infobox:renderItem({');
			lines.push('            label = ' + luaString(row.label || titleCase(row.source)) + ',');
			lines.push('            data = ' + luaData(row));
			lines.push('        }))');
		} else if (row.type === 'header') {
			const headerValue = row.source ? luaArg(row.source, row.defaultValue || row.label) : luaString(row.label || row.defaultValue || '');
			lines.push('        table.insert(' + tableVar + ', infobox:renderItem({');
			lines.push('            data = "\'\'\'" .. ' + headerValue + ' .. "\'\'\'"');
			lines.push('        }))');
		} else if (row.type === 'image') {
			lines.push('        table.insert(' + tableVar + ', infobox:renderImage(' + luaArg(row.source, row.defaultValue) + '))');
		} else if (row.type === 'title') {
			lines.push('        table.insert(' + tableVar + ', infobox:renderHeader({ title = ' + luaArg(row.source, row.defaultValue) + ' }))');
		} else if (row.type === 'section') {
			lines.push('        table.insert(' + tableVar + ', infobox:renderSection({');
			if (row.label) lines.push('            title = ' + luaString(row.label) + ',');
			lines.push('            content = (function()');
			lines.push('                local nestedRows = {}');
			renderLuaRows(lines, row.rows, 'nestedRows');
			lines.push('                return table.concat(nestedRows)');
			lines.push('            end)()');
			lines.push('        }, true))');
		}
	}
}

function renderLuaPanel(lines, panel) {
	lines.push('');
	lines.push('    do');
	lines.push('        local tabberData = {}');

	for (var i = 0; i < panel.sections.length; i++) {
		const tab = panel.sections[i];
		const idx = i + 1;
		lines.push("        tabberData['label" + idx + "'] = " + luaString(tab.label));
		lines.push('        do');
		lines.push('            local sectionRows = {}');
		renderLuaRows(lines, tab.rows, 'sectionRows');
		lines.push("            tabberData['content" + idx + "'] = infobox:renderSection({ content = table.concat(sectionRows) }, true)");
		lines.push('        end');
	}

	lines.push('        infobox:renderSection({');
	lines.push("            class = 'infobox__section--tabber',");
	lines.push('            content = tabber(tabberData)');
	lines.push('        })');
	lines.push('    end');
}

function titleCase(value) {
	return cleanText(value || 'Data')
		.replace(/[_-]+/g, ' ')
		.replace(/\b\w/g, function(character) { return character.toUpperCase(); });
}

function luaData(row) {
	return row.formatValue ? luaString(row.formatValue) : luaArg(row.source, row.defaultValue);
}

function luaComments(comments, indent) {
	return (comments || []).map(function(comment) { return indent + '-- ' + comment.replace(/^<!--\s*/, '').replace(/\s*-->$/, ''); });
}

function render() {
	const { model, notes } = parsePortableInfobox(sourceInput.value);
	const output = currentMode === 'template' ? makeTemplateOutput(model) : makeModuleOutput(model);
	outputBox.textContent = output;
	notesList.innerHTML = '';
	notes.forEach(function(note) {
		const item = document.createElement('li');
		item.textContent = note;
		notesList.appendChild(item);
	});
}

function setMode(mode) {
	currentMode = mode;
	const isTemplate = mode === 'template';
	templateTab.classList.toggle('active', isTemplate);
	moduleTab.classList.toggle('active', !isTemplate);
	templateTab.setAttribute('aria-selected', String(isTemplate));
	moduleTab.setAttribute('aria-selected', String(!isTemplate));
	render();
}

sourceInput.addEventListener('input', render);
templateTab.addEventListener('click', function() { setMode('template'); });
moduleTab.addEventListener('click', function() { setMode('module'); });

const copyIcon = copyButton.querySelector(".material-symbols-outlined");

copyButton.addEventListener("click", async function() {
    const copied = await copyText(outputBox.textContent);

    if (copied) {
        copyIcon.textContent = "check";

        setTimeout(function() {
            copyIcon.textContent = "content_copy";
        }, 1100);
    }
});

async function copyText(text) {
	if (navigator.clipboard && navigator.clipboard.writeText) {
		try {
			await navigator.clipboard.writeText(text);
			return true;
		} catch (error) {
			// Fall through to the selection-based copy path for local file pages.
		}
	}

	const helper = document.createElement('textarea');
	helper.value = text;
	helper.setAttribute('readonly', '');
	helper.style.position = 'fixed';
	helper.style.opacity = '0';
	document.body.appendChild(helper);
	helper.select();
	let ok = false;
	try {
		ok = document.execCommand('copy');
	} catch (error) {
		ok = false;
	}
	helper.remove();
	return ok;
}

sourceInput.value = sample;
render();
