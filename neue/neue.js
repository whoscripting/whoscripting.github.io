const sourceInput = document.getElementById('sourceInput');
const outputBox = document.getElementById('outputBox');
const notesList = document.getElementById('notesList');
const templateTab = document.getElementById('templateTab');
const moduleTab = document.getElementById('moduleTab');
const copyButton = document.getElementById('copyButton');

let currentMode = 'template';

const sample = `<infobox>
  <title source="title1">
    <default>{{PAGENAME}}</default>
  </title>
  <image source="image1">
    <default>Placeholder.png</default>
  </image>
  <data source="parameter">
    <label>Parameter</label>
  </data>
</infobox>`;

function cleanText(value) {
	return (value || '')
		.replace(/\r/g, '')
		.replace(/\n[ \t]+/g, '\n')
		.replace(/[ \t]+\n/g, '\n')
		.trim();
}

function attrValue(tag, name) {
	const pattern = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>/]+))`, 'i');
	const match = tag.match(pattern);
	return match ? cleanText(match[2] || match[3] || match[4] || '') : '';
}

function stripTags(value) {
	return cleanText(value.replace(/<[^>]+>/g, ''));
}

function readComments(value) {
	return Array.from((value || '').matchAll(/<!--[\s\S]*?-->/g), match => match[0].trim());
}

function childContent(block, tagName) {
	const match = block.match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i'));
	if (match) return cleanText(match[1]);
	const selfClosing = block.match(new RegExp(`<${tagName}\\b([^>]*)\\/>`, 'i'));
	if (selfClosing) return '';
	return '';
}

function childAttr(block, tagName, name) {
	const match = block.match(new RegExp(`<${tagName}\\b([^>]*)>`, 'i'));
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
	const tokenPattern = /<(title|image|header|data|group|panel|section|label)\b[^>]*(?:\/>|>)|<!--[\s\S]*?-->/ig;
	let match;
	let pendingComments = [];

	while ((match = tokenPattern.exec(markup)) !== null) {
		if (match[0].startsWith('<!--')) {
			pendingComments.push(match[0]);
			continue;
		}
		const tagName = match[1].toLowerCase();
		const openTag = match[0];
		const start = match.index;

		if (openTag.endsWith('/>')) {
			blocks.push({ tagName, openTag, body: '', full: openTag, start, comments: pendingComments });
			pendingComments = [];
			continue;
		}

		let depth = 1;
		let bodyEnd = -1;
		let fullEnd = -1;

		const searchPattern = new RegExp(`(<${tagName}\\b[^>]*(?:\\/>|>))|(</${tagName}>)|<!--[\\s\\S]*?-->`, 'ig');
		searchPattern.lastIndex = tokenPattern.lastIndex;

		let subMatch;
		while ((subMatch = searchPattern.exec(markup)) !== null) {
			if (subMatch[1]) {
				if (!subMatch[1].endsWith('/>')) {
					depth++;
				}
			} else if (subMatch[2]) {
				depth--;
				if (depth === 0) {
					bodyEnd = subMatch.index;
					fullEnd = searchPattern.lastIndex;
					break;
				}
			}
		}

		if (depth === 0) {
			const body = markup.slice(tokenPattern.lastIndex, bodyEnd);
			const full = markup.slice(start, fullEnd);
			blocks.push({ tagName, openTag, body, full, start, comments: pendingComments });
			pendingComments = [];
			tokenPattern.lastIndex = fullEnd;
		} else {
			// No matching close tag found
			blocks.push({ tagName, openTag, body: '', full: openTag, start, comments: pendingComments });
			pendingComments = [];
		}
	}

	if (pendingComments.length > 0) {
		blocks.push({ tagName: 'comment', comments: pendingComments });
	}

	return blocks;
}

function wikitextParam(source, fallback = '') {
	if (!source) return fallback || '';
	return `{{{${source}|${fallback}}}}`;
}

function luaArg(source, fallback = "''") {
	if (!source) return luaString(fallback.replace(/^''$/, ''));
	const defaultValue = fallback && fallback !== "''" ? ` or ${luaString(fallback)}` : '';
	return `args[${luaString(source)}]${defaultValue}`;
}

function luaString(value) {
	return `'${String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
}

function parseBlocks(markup, notes) {
	const blocks = readBlocks(markup);
	const rows = [];

	for (const block of blocks) {
		if (block.comments && block.comments.length > 0) {
			for (const comment of block.comments) {
				rows.push({
					type: 'comment',
					content: comment
				});
			}
		}

		const tagName = block.tagName;
		if (tagName === 'comment') {
			continue;
		}

		if (tagName === 'title') {
			rows.push({
				type: 'title',
				source: attrValue(block.openTag, 'source'),
				defaultValue: stripTags(childContent(block.full, 'default')),
				comments: []
			});
		} else if (tagName === 'image') {
			rows.push({
				type: 'image',
				source: attrValue(block.openTag, 'source') || 'image',
				captionSource: childAttr(block.full, 'caption', 'source'),
				captionDefault: stripTags(childContent(block.full, 'caption')),
				defaultValue: stripTags(childContent(block.full, 'default')),
				comments: []
			});
		} else if (tagName === 'header') {
			rows.push({
				type: 'header',
				label: stripTags(block.body),
				source: attrValue(block.openTag, 'source'),
				defaultValue: stripTags(childContent(block.full, 'default')),
				comments: []
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
			const titleRow = children.find(r => r.type === 'label' || r.type === 'header');
			const label = titleRow ? (titleRow.label || titleRow.body) : '';
			rows.push({
				type: 'section',
				label: label,
				rows: children.filter(r => r !== titleRow)
			});
			if (tagName === 'group' && /layout\s*=\s*["']?horizontal/i.test(block.openTag)) {
				notes.push('Horizontal groups are preserved as a section, but exact PortableInfobox mobile layout cannot be inferred.');
			}
		} else if (tagName === 'panel') {
			const sections = [];
			const subBlocks = readBlocks(block.body);
			let tabIndex = 1;
			let defaultSectionRows = [];

			for (const sub of subBlocks) {
				if (sub.tagName === 'section') {
					if (defaultSectionRows.length > 0) {
						sections.push({
							type: 'section',
							label: `Tab ${tabIndex++}`,
							rows: defaultSectionRows
						});
						defaultSectionRows = [];
					}
					const children = parseBlocks(sub.body, notes);
					const titleRow = children.find(r => r.type === 'label' || r.type === 'header');
					const label = titleRow ? (titleRow.label || titleRow.body) : '';
					sections.push({
						type: 'section',
						label: label || `Tab ${tabIndex++}`,
						rows: children.filter(r => r !== titleRow)
					});
				} else if (sub.tagName === 'comment') {
					for (const comment of sub.comments) {
						defaultSectionRows.push({ type: 'comment', content: comment });
					}
				} else {
					const parsed = parseBlocks(sub.full, notes);
					defaultSectionRows.push(...parsed);
				}
			}

			if (defaultSectionRows.length > 0) {
				sections.push({
					type: 'section',
					label: `Tab ${tabIndex++}`,
					rows: defaultSectionRows
				});
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

	const title = rows.find(r => r.type === 'title');
	const image = rows.find(r => r.type === 'image');

	const model = {
		title: title || null,
		image: image || null,
		rows: rows.filter(r => r !== title && r !== image),
		leadingComments: readLeadingComments(input),
		includePrelude: bounds ? cleanText(sourceBody.slice(0, bounds.start)) : '',
		includePostlude: bounds ? cleanText(sourceBody.slice(bounds.end)) : '',
		hasIncludeOnly: /<includeonly\b/i.test(input),
		hasNoInclude: /<noinclude\b/i.test(input),
		noincludeContent,
		rawBlockCount: rows.length
	};

	if (!input.trim()) {
		notes.push('Paste a PortableInfobox template to begin.');
		return { model, notes };
	}

	if (!/<infobox\b/i.test(input)) {
		notes.push('No <infobox> wrapper was found, so the whole input was treated as infobox contents.');
	}

	if (!model.title) notes.push('No title tag was found. The generated output falls back to the page title.');
	if (!model.image) notes.push('No image tag was found. You can add one manually if the target infobox needs it.');
	if (model.image?.captionSource || model.image?.captionDefault) {
		notes.push('InfoboxNeue fromArgs/renderImage does not expose an image caption slot in the documented Star Citizen/Dovedale version.');
	}
	if (!model.rows.length) notes.push('No data rows were found.');
	if (/<(?:navigation|audio|video)\b/i.test(input)) {
		notes.push('Some specialized PortableInfobox tags were detected and are not converted automatically.');
	}
	if (hasAnyPanel(model.rows)) {
		notes.push('Panels are converted to tabbers for Module output, but are ignored in Template output.');
	}
	if (model.leadingComments.length) notes.push('Template comments were preserved in the generated output.');
	if (model.includePrelude || model.includePostlude) notes.push('Wikitext outside the infobox was preserved inside includeonly output.');
	if (model.noincludeContent) notes.push('Noinclude content was preserved because it existed in the source.');

	return { model, notes };
}

function hasAnyPanel(rows) {
	for (const row of rows) {
		if (row.type === 'panel') return true;
		if (row.type === 'section' && hasAnyPanel(row.rows)) return true;
	}
	return false;
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
		comments: []
	};
}

function makeTemplateOutput(model) {
	const lines = [];
	const titleSource = model.title?.source || 'title';
	const titleFallback = model.title?.defaultValue || '{{PAGENAME}}';
	let sectionIndex = 1;
	let itemIndex = 1;

	lines.push(...model.leadingComments);
	if (model.leadingComments.length) lines.push('');
	if (model.hasIncludeOnly) lines.push('<includeonly>');
	if (model.includePrelude) lines.push(model.includePrelude);
	lines.push('{{InfoboxNeue');
	lines.push(`| title = ${wikitextParam(titleSource, titleFallback)}`);

	if (model.image) {
		lines.push(`| image = ${wikitextParam(model.image.source, model.image.defaultValue)}`);
	}

	function renderRows(rows) {
		for (const entry of rows) {
			if (entry.type === 'panel') {
				renderRows(entry.sections);
				continue;
			}
			if (entry.type === 'section') {
				if (entry.label) {
					lines.push(`| section${sectionIndex} = ${entry.label}`);
					sectionIndex += 1;
				}
				renderRows(entry.rows);
			} else if (entry.type === 'header') {
				lines.push(`| section${sectionIndex} = ${entry.label || wikitextParam(entry.source, entry.defaultValue)}`);
				sectionIndex += 1;
			} else if (entry.type === 'data') {
				lines.push(`| label${itemIndex} = ${entry.label || titleCase(entry.source)}`);
				lines.push(`| content${itemIndex} = ${templateContent(entry)}`);
				itemIndex += 1;
			} else if (entry.type === 'comment') {
				lines.push(entry.content);
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

function prefixComments(comments = []) {
	return comments;
}

function templateContent(row) {
	return row.formatValue || wikitextParam(row.source, row.defaultValue);
}

function makeModuleOutput(model) {
	const hasPanel = hasAnyPanel(model.rows);
	const lines = [
		'local p = {}',
		'',
		"local getArgs = require('Module:Arguments').getArgs",
		"local InfoboxNeue = require('Module:InfoboxNeue')",
	];

	if (hasPanel) {
		lines.push("local tabber = require('Module:Tabber').renderTabber");
	}

	lines.push(
		'',
		`function p.main(frame)`,
		'    local args = getArgs(frame)',
		'    local infobox = InfoboxNeue:new()',
		''
	);

	if (model.image) {
		lines.push(`    infobox:renderImage(${luaArg(model.image.source, model.image.defaultValue)})`);
		lines.push('');
	}

	const titleSource = model.title?.source || 'title';
	const titleFallback = (typeof mw !== 'undefined' ? mw.title.getCurrentTitle().text : 'Page Title');
	lines.push('    infobox:renderHeader({');
	lines.push(`        title = ${luaArg(titleSource, titleFallback)},`);
	lines.push('    })');

	for (const section of makeModuleSections(model.rows)) {
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

	for (const row of rows) {
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
		if (section.label) lines.push(`            title = ${luaString(section.label)},`);
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
	if (label) lines.push(`            title = ${luaString(label)},`);
	lines.push('            content = table.concat(sectionRows)');
	lines.push('        })');
	lines.push('    end');
}

function renderLuaRows(lines, rows, tableVar) {
	for (const row of rows) {
		if (row.type === 'data') {
			lines.push(`        table.insert(${tableVar}, infobox:renderItem({`);
			lines.push(`            label = ${luaString(row.label || titleCase(row.source))},`);
			lines.push(`            data = ${luaData(row)}`);
			lines.push('        }))');
		} else if (row.type === 'header') {
			let resolvedLabel;
			if (row.label) {
				resolvedLabel = luaString(row.label);
			} else {
				resolvedLabel = luaArg(row.source, row.defaultValue);
			}
			lines.push(`        table.insert(${tableVar}, infobox:renderItem({`);
			lines.push(`            data = "'''" .. ${resolvedLabel} .. "'''"`);
			lines.push('        }))');
		} else if (row.type === 'image') {
			lines.push(`        table.insert(${tableVar}, infobox:renderImage(${luaArg(row.source, row.defaultValue)}))`);
		} else if (row.type === 'title') {
			lines.push(`        table.insert(${tableVar}, infobox:renderHeader({ title = ${luaArg(row.source, row.defaultValue)} }))`);
		} else if (row.type === 'comment') {
			lines.push(...luaComments([row.content], '        '));
		} else if (row.type === 'section') {
			lines.push(`        table.insert(${tableVar}, infobox:renderSection({`);
			if (row.label) lines.push(`            title = ${luaString(row.label)},`);
			lines.push('            content = (function()');
			lines.push('                local nestedRows = {}');
			renderLuaRows(lines, row.rows, 'nestedRows');
			lines.push('                return table.concat(nestedRows)');
			lines.push('            end)()');
			lines.push('        }, true))');
		} else if (row.type === 'panel') {
			lines.push(`        table.insert(${tableVar}, (function()`);
			lines.push('            local tabberData = {}');
			row.sections.forEach((tab, index) => {
				const idx = index + 1;
				lines.push(`            tabberData['label${idx}'] = ${luaString(tab.label)}`);
				lines.push('            do');
				lines.push('                local innerRows = {}');
				renderLuaRows(lines, tab.rows, 'innerRows');
				lines.push(`                tabberData['content${idx}'] = infobox:renderSection({ content = table.concat(innerRows) }, true)`);
				lines.push('            end');
			});
			lines.push('            return tabber(tabberData)');
			lines.push('        end)())');
		}
	}
}

function renderLuaPanel(lines, panel) {
	lines.push('');
	lines.push('    do');
	lines.push('        local tabberData = {}');

	panel.sections.forEach((tab, index) => {
		const idx = index + 1;
		lines.push(`        tabberData['label${idx}'] = ${luaString(tab.label)}`);
		lines.push('        do');
		lines.push('            local sectionRows = {}');
		renderLuaRows(lines, tab.rows, 'sectionRows');
		lines.push(`            tabberData['content${idx}'] = infobox:renderSection({ content = table.concat(sectionRows) }, true)`);
		lines.push('        end');
	});

	lines.push('        infobox:renderSection({');
	lines.push("            class = 'infobox__section--tabber',");
	lines.push('            content = tabber(tabberData)');
	lines.push('        })');
	lines.push('    end');
}

function titleCase(value) {
	return cleanText(value || 'Data')
		.replace(/[_-]+/g, ' ')
		.replace(/\b\w/g, character => character.toUpperCase());
}

function luaData(row) {
	return row.formatValue ? luaString(row.formatValue) : luaArg(row.source, row.defaultValue);
}

function luaComments(comments = [], indent = '') {
	const result = [];
	for (const comment of comments) {
		const content = comment.replace(/^<!--\s*/, '').replace(/\s*-->$/, '');
		const lines = content.split(/\r?\n/);
		for (const line of lines) {
			result.push(`${indent}-- ${line}`);
		}
	}
	return result;
}

function render() {
	const { model, notes } = parsePortableInfobox(sourceInput.value);
	const output = currentMode === 'template' ? makeTemplateOutput(model) : makeModuleOutput(model);
	outputBox.textContent = output;
	notesList.innerHTML = '';
	notes.forEach(note => {
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
templateTab.addEventListener('click', () => setMode('template'));
moduleTab.addEventListener('click', () => setMode('module'));

const copyIcon = copyButton.querySelector(".material-symbols-outlined");

copyButton.addEventListener("click", async () => {
    const copied = await copyText(outputBox.textContent);

    if (copied) {
        copyIcon.textContent = "check";

        setTimeout(() => {
            copyIcon.textContent = "content_copy";
        }, 1100);
    }
});

async function copyText(text) {
	if (navigator.clipboard?.writeText) {
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
