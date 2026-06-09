const sourceInput = document.getElementById('sourceInput');
const outputBox = document.getElementById('outputBox');
const notesList = document.getElementById('notesList');
const statusPill = document.getElementById('statusPill');
const templateTab = document.getElementById('templateTab');
const moduleTab = document.getElementById('moduleTab');
const copyButton = document.getElementById('copyButton');
const templateName = document.getElementById('templateName');

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
  const tokenPattern = /<(title|image|header|data|group)\b[^>]*(?:\/>|>)/ig;
  let match;

  while ((match = tokenPattern.exec(markup)) !== null) {
    const tagName = match[1].toLowerCase();
    const openTag = match[0];
    const start = match.index;

    if (openTag.endsWith('/>')) {
      blocks.push({ tagName, openTag, body: '', full: openTag, start });
      continue;
    }

    const closePattern = new RegExp(`</${tagName}>`, 'ig');
    closePattern.lastIndex = tokenPattern.lastIndex;
    const close = closePattern.exec(markup);
    if (!close) {
      blocks.push({ tagName, openTag, body: '', full: openTag, start });
      continue;
    }

    const body = markup.slice(tokenPattern.lastIndex, close.index);
    const full = markup.slice(start, close.index + close[0].length);
    blocks.push({ tagName, openTag, body, full, start });
    tokenPattern.lastIndex = close.index + close[0].length;
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

function parsePortableInfobox(input) {
  const notes = [];
  const sourceBody = includeOnlyInner(input);
  const inner = topLevelInner(sourceBody);
  const blocks = readBlocks(inner);
  const bounds = infoboxOuterBounds(sourceBody);
  const noinclude = noIncludeInner(input);
  const noincludeContent = cleanText(noinclude);
  const model = {
    title: null,
    subtitle: null,
    image: null,
    rows: [],
    leadingComments: readLeadingComments(input),
    includePrelude: bounds ? cleanText(sourceBody.slice(0, bounds.start)) : '',
    includePostlude: bounds ? cleanText(sourceBody.slice(bounds.end)) : '',
    hasIncludeOnly: /<includeonly\b/i.test(input),
    hasNoInclude: /<noinclude\b/i.test(input),
    noincludeContent,
    rawBlockCount: blocks.length
  };

  if (!input.trim()) {
    notes.push('Paste a PortableInfobox template to begin.');
    return { model, notes };
  }

  if (!/<infobox\b/i.test(input)) {
    notes.push('No <infobox> wrapper was found, so the whole input was treated as infobox contents.');
  }

  for (const block of blocks) {
    if (block.tagName === 'title') {
      model.title = {
        source: attrValue(block.openTag, 'source'),
        defaultValue: stripTags(childContent(block.full, 'default')),
        comments: readComments(block.full)
      };
      continue;
    }

    if (block.tagName === 'image') {
      model.image = {
        source: attrValue(block.openTag, 'source') || 'image',
        captionSource: childAttr(block.full, 'caption', 'source'),
        captionDefault: stripTags(childContent(block.full, 'caption')),
        defaultValue: stripTags(childContent(block.full, 'default')),
        comments: readComments(block.full)
      };
      continue;
    }

    if (block.tagName === 'header') {
      model.rows.push({
        type: 'header',
        label: stripTags(block.body),
        source: attrValue(block.openTag, 'source'),
        defaultValue: stripTags(childContent(block.full, 'default')),
        comments: readComments(block.full)
      });
      continue;
    }

    if (block.tagName === 'data') {
      model.rows.push(readDataBlock(block));
      continue;
    }

    if (block.tagName === 'group') {
      const groupBlocks = readBlocks(block.body);
      const groupHeader = groupBlocks.find(item => item.tagName === 'header');
      const groupRows = groupBlocks.filter(item => item.tagName === 'data').map(readDataBlock);
      model.rows.push({
        type: 'section',
        label: groupHeader ? stripTags(groupHeader.body) : '',
        rows: groupRows
      });
      if (/layout\s*=\s*["']?horizontal/i.test(block.openTag)) {
        notes.push('Horizontal groups are preserved as a section, but exact PortableInfobox mobile layout cannot be inferred.');
      }
    }
  }

  if (!model.title) notes.push('No title tag was found. The generated output falls back to the page title.');
  if (!model.image) notes.push('No image tag was found. You can add one manually if the target infobox needs it.');
  if (model.image?.captionSource || model.image?.captionDefault) {
    notes.push('InfoboxNeue fromArgs/renderImage does not expose an image caption slot in the documented Star Citizen/Dovedale version.');
  }
  if (!model.rows.length) notes.push('No data rows were found.');
  if (/<(?:panel|navigation|audio|video)\b/i.test(input)) {
    notes.push('Some specialized PortableInfobox tags were detected and are not converted automatically.');
  }
  if (model.leadingComments.length) notes.push('Template comments were preserved in the generated output.');
  if (model.includePrelude || model.includePostlude) notes.push('Wikitext outside the infobox was preserved inside includeonly output.');
  if (model.noincludeContent) notes.push('Noinclude content was preserved because it existed in the source.');

  return { model, notes };
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
  const rows = [];
  const titleSource = model.title?.source || 'title';
  const titleFallback = model.title?.defaultValue || '{{PAGENAME}}';
  let sectionIndex = 1;
  let itemIndex = 1;

  rows.push(...model.leadingComments);
  if (model.leadingComments.length) rows.push('');
  if (model.hasIncludeOnly) rows.push('<includeonly>');
  if (model.includePrelude) rows.push(model.includePrelude);
  rows.push('{{InfoboxNeue');
  rows.push(`| title = ${wikitextParam(titleSource, titleFallback)}`);

  if (model.image) {
    rows.push(...prefixComments(model.image.comments));
    rows.push(`| image = ${wikitextParam(model.image.source, model.image.defaultValue)}`);
  }

  for (const entry of model.rows) {
    if (entry.type === 'section') {
      if (entry.label) {
        rows.push(`| section${sectionIndex} = ${entry.label}`);
        sectionIndex += 1;
      }
      for (const child of entry.rows) {
        rows.push(...prefixComments(child.comments));
        rows.push(`| label${itemIndex} = ${child.label || titleCase(child.source)}`);
        rows.push(`| content${itemIndex} = ${templateContent(child)}`);
        itemIndex += 1;
      }
    } else if (entry.type === 'header') {
      rows.push(...prefixComments(entry.comments));
      rows.push(`| section${sectionIndex} = ${entry.label || wikitextParam(entry.source, entry.defaultValue)}`);
      sectionIndex += 1;
    } else {
      rows.push(...prefixComments(entry.comments));
      rows.push(`| label${itemIndex} = ${entry.label || titleCase(entry.source)}`);
      rows.push(`| content${itemIndex} = ${templateContent(entry)}`);
      itemIndex += 1;
    }
  }

  rows.push('}}');
  if (model.includePostlude) rows.push(model.includePostlude);
  if (model.hasIncludeOnly) rows.push('</includeonly>');
  if (model.hasNoInclude && model.noincludeContent) {
    rows.push('<noinclude>');
    rows.push(model.noincludeContent);
    rows.push('</noinclude>');
  }
  return rows.join('\n');
}

function prefixComments(comments = []) {
  return comments;
}

function templateContent(row) {
  return row.formatValue || wikitextParam(row.source, row.defaultValue);
}

function makeModuleOutput(model) {
  const name = templateName.value.trim().replace(/^Infobox\s*/i, '') || 'Converted';
  const safeName = name.replace(/[^A-Za-z0-9_]/g, '');
  const lines = [
    'local p = {}',
    '',
    "local getArgs = require('Module:Arguments').getArgs",
    "local InfoboxNeue = require('Module:InfoboxNeue')",
    '',
    `function p.${safeName || 'infobox'}(frame)`,
    '    local args = getArgs(frame)',
    '    local infobox = InfoboxNeue:new()',
    ''
  ];

  const titleSource = model.title?.source || 'title';
  const titleFallback = model.title?.defaultValue || '{{PAGENAME}}';
  lines.push(...luaComments(model.title?.comments, '    '));
  lines.push('    infobox:renderHeader({');
  lines.push(`        title = ${luaArg(titleSource, titleFallback)}`);
  lines.push('    })');

  if (model.image) {
    lines.push('');
    lines.push(...luaComments(model.image.comments, '    '));
    lines.push(`    infobox:renderImage(${luaArg(model.image.source)})`);
  }

  for (const section of makeModuleSections(model.rows)) {
    renderLuaSection(lines, section);
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
    if (row.type === 'section') {
      if (current.rows.length) sections.push(current);
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
  const label = section.label || '';
  lines.push('');
  lines.push('    do');
  lines.push('        local sectionRows = {}');

  for (const row of section.rows) {
    lines.push(...luaComments(row.comments, '        '));
    lines.push('        table.insert(sectionRows, infobox:renderItem({');
    lines.push(`            label = ${luaString(row.label || titleCase(row.source))},`);
    lines.push(`            data = ${luaData(row)}`);
    lines.push('        }))');
  }

  lines.push('        infobox:renderSection({');
  if (label) lines.push(`            title = ${luaString(label)},`);
  lines.push('            content = table.concat(sectionRows)');
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
  return comments.map(comment => `${indent}-- ${comment.replace(/^<!--\s*/, '').replace(/\s*-->$/, '')}`);
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
  statusPill.textContent = `${model.rawBlockCount} block${model.rawBlockCount === 1 ? '' : 's'} parsed`;
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
templateName.addEventListener('input', render);
templateTab.addEventListener('click', () => setMode('template'));
moduleTab.addEventListener('click', () => setMode('module'));

copyButton.addEventListener('click', async () => {
  const copied = await copyText(outputBox.textContent);
  const previous = copyButton.textContent;
  copyButton.textContent = copied ? 'Copied' : 'Select text';
  setTimeout(() => {
    copyButton.textContent = previous;
  }, 1100);
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
