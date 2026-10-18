const initialState = {
	title: 'Title',
	subtitle: 'Subtitle',
	snippet: 'InfoboxNeue',
	headerColumns: 2,
	indicator: '',
	indicatorClass: '',
	headerItems: [],
	sections: [
		{ title: 'Quick facts', subtitle: '', layout: 'grid', columns: 2, items: [{ label: '', data: '', description: '', span: 1 }] }
	]
};

let state = structuredClone(initialState);
let outputMode = 'template';
let activeEditor = { type: 'header' };
let primaryAddSectionObserver;
let history = [structuredClone(initialState)];
let historyIndex = 0;
let selectedItemIds = new Set();
let selectionGesture;
let copiedItems = [];

const preview = document.getElementById('preview');
const contextPopover = document.getElementById('contextPopover');
const codeOutput = document.getElementById('codeOutput');
const codeDescription = document.getElementById('codeDescription');
const templateTab = document.getElementById('templateTab');
const moduleTab = document.getElementById('moduleTab');
const stickyAddSection = document.getElementById('stickyAddSection');

function escapeHtml(value) {
	return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character]));
}

function luaString(value) {
	return `'${String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
}

function getActiveTarget() {
	if (activeEditor.type === 'section') return state.sections[activeEditor.sectionIndex];
	if (activeEditor.type === 'item') return getItemCollection(activeEditor.sectionIndex)?.[activeEditor.itemIndex];
	return state;
}

function getItemCollection(sectionIndex) {
	return sectionIndex === -1 ? state.headerItems : state.sections[sectionIndex]?.items;
}

function makeItemId() {
	return globalThis.crypto?.randomUUID?.() || `item-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function ensureItemIds() {
	[state.headerItems, ...state.sections.map(section => section.items)].forEach(items => items.forEach(item => {
		item.id ||= makeItemId();
	}));
}

function makeEmptyItem() {
	return { id: makeItemId(), label: '', data: '', description: '', span: 1 };
}

function cloneItem(item) {
	return { ...structuredClone(item), id: makeItemId() };
}

function getItemLocations() {
	return [
		...state.headerItems.map((item, itemIndex) => ({ item, itemIndex, sectionIndex: -1 })),
		...state.sections.flatMap((section, sectionIndex) => section.items.map((item, itemIndex) => ({ item, itemIndex, sectionIndex })))
	];
}

function getSelectedLocations() {
	return getItemLocations().filter(({ item }) => selectedItemIds.has(item.id));
}

function pruneSelectedItems() {
	const ids = new Set(getItemLocations().map(({ item }) => item.id));
	selectedItemIds = new Set([...selectedItemIds].filter(id => ids.has(id)));
}

function setSelectedItems(ids) {
	selectedItemIds = new Set(ids);
	preview.querySelectorAll('.ib-item').forEach(item => item.classList.toggle('is-selected', selectedItemIds.has(item.dataset.itemId)));
}

function promoteSection(sectionIndex) {
	const section = state.sections[sectionIndex];
	if (!section) return;
	state.headerItems.unshift(...section.items);
	state.sections.splice(sectionIndex, 1);
	pruneSelectedItems();
	activeEditor = { type: 'header' };
}

function input(label, field, value, options = {}) {
	const type = options.type || 'text';
	const help = options.help || (options.optional ? 'optional' : '');
	return `<label>${label}${help ? ` <span>${help}</span>` : ''}<input data-field="${field}" type="${type}" value="${escapeHtml(value)}" placeholder="${escapeHtml(options.placeholder || '')}" ${options.required ? 'required' : ''}></label>`;
}

function select(label, field, value, choices) {
	return `<label>${label}<select data-field="${field}">${choices.map(([optionValue, optionLabel]) => `<option value="${optionValue}" ${String(value) === String(optionValue) ? 'selected' : ''}>${optionLabel}</option>`).join('')}</select></label>`;
}

function spanControl(value) {
	return rangeControl('Column span', 'span', value);
}

function columnsControl(value, field = 'columns') {
	return rangeControl('Columns', field, value, { help: 'optional; defaults to 2' });
}

function rangeControl(label, field, value, options = {}) {
	const inputId = `range-${field}`;
	return `<div class="range-control"><label for="${inputId}">${label}${options.help ? `<span>${options.help}</span>` : ''}</label><div class="span-range"><input id="${inputId}" data-field="${field}" type="range" min="1" max="4" value="${value}"><output for="${inputId}">${value}</output></div></div>`;
}

function recordState() {
	history = history.slice(0, historyIndex + 1);
	history.push(structuredClone(state));
	historyIndex = history.length - 1;
}

function restoreHistory(index) {
	if (index < 0 || index >= history.length) return;
	historyIndex = index;
	state = structuredClone(history[historyIndex]);
	ensureItemIds();
	pruneSelectedItems();
	render();
}

function undo() {
	restoreHistory(historyIndex - 1);
}

function redo() {
	restoreHistory(historyIndex + 1);
}

function animatePopoverHeight(previousHeight) {
	if (!contextPopover.classList.contains('is-open') || previousHeight === 0) return;
	const nextHeight = contextPopover.scrollHeight;
	if (previousHeight === nextHeight) return;
	contextPopover.style.height = `${previousHeight}px`;
	requestAnimationFrame(() => {
		contextPopover.style.height = `${nextHeight}px`;
		contextPopover.addEventListener('transitionend', () => { contextPopover.style.height = ''; }, { once: true });
	});
}

function renderPopover() {
	const previousHeight = contextPopover.getBoundingClientRect().height;
	const target = getActiveTarget();
	if (!target && activeEditor.type !== 'new-section') {
		activeEditor = { type: 'header' };
		return renderPopover();
	}

	let heading = '';
	let body = '';
	if (activeEditor.type === 'header') {
		heading = 'Header';
		body = `<div class="field-stack">${input('Title', 'title', state.title)}${input('Subtitle', 'subtitle', state.subtitle, { optional: true })}</div>`;
	} else if (activeEditor.type === 'image') {
		heading = 'Image';
		body = '<p class="field-help">The preview and generated code use the fixed clouds placeholder image.</p>';
	} else if (activeEditor.type === 'snippet') {
		heading = 'Quick facts';
		body = `<div class="field-stack">${input('Snippet', 'snippet', state.snippet, { help: 'optional; defaults to page name', placeholder: 'Page name' })}</div>`;
	} else if (activeEditor.type === 'indicator') {
		heading = 'Indicator';
		body = `<div class="field-stack">${input('Text', 'indicator', state.indicator, { optional: true })}${select('Class', 'indicatorClass', state.indicatorClass, [['', 'None'], ['infobox__indicator--green', 'Green'], ['infobox__indicator--yellow', 'Yellow'], ['infobox__indicator--red', 'Red']])}</div>`;
	} else if (activeEditor.type === 'header-content') {
		heading = 'Title details';
		body = `<div class="field-stack">${columnsControl(state.headerColumns, 'headerColumns')}</div>`;
	} else if (activeEditor.type === 'section') {
		heading = 'Section';
		const addItemAction = target.items.length > 0 ? '<button class="add-button" data-action="add-item" type="button">+ Add item</button>' : '';
		body = `<div class="field-stack">${input('Section title', 'title', target.title, { required: true })}${input('Section subtitle', 'subtitle', target.subtitle || '', { optional: true })}${select('Layout', 'layout', target.layout || 'grid', [['grid', 'Grid'], ['row', 'Row'], ['list', 'List']])}<p class="template-disclaimer">Row and list layouts are only available in Module output.</p>${target.layout === 'grid' ? columnsControl(target.columns) : ''}</div><div class="popover-actions">${addItemAction}<button class="remove-button" data-action="remove-section" type="button" aria-label="Remove section" title="Remove section"><span class="material-symbols-outlined">delete</span></button></div>`;
	} else if (activeEditor.type === 'selection') {
		const count = getSelectedLocations().length;
		heading = `${count} items selected`;
		const destinations = [['-1', 'Below title and subtitle'], ...state.sections.map((section, index) => [String(index), section.title || `Section ${index + 1}`])];
		body = `<div class="field-stack"><label>Move selected items<select data-selection-move><option value="">Choose a destination</option>${destinations.map(([value, label]) => `<option value="${value}">${escapeHtml(label)}</option>`).join('')}</select></label></div><div class="popover-actions"><button class="remove-button" data-action="remove-selected-items" type="button"><span class="material-symbols-outlined">delete</span> Delete selected</button></div>`;
	} else if (activeEditor.type === 'item') {
		heading = 'Item';
		const layout = activeEditor.sectionIndex === -1 ? 'grid' : state.sections[activeEditor.sectionIndex].layout || 'grid';
		body = `<div class="field-stack">${layout === 'list' ? input('Title', 'data', target.data, { placeholder: 'Item data' }) + input('Description', 'description', target.description, { optional: true }) : input('Label', 'label', target.label, { optional: true, placeholder: 'Item label' }) + input('Data', 'data', target.data, { placeholder: 'Item data' })}${layout === 'grid' ? `${spanControl(target.span)}<p class="template-disclaimer">Column span is only available in Module output.</p>` : ''}</div><div class="popover-actions"><button class="remove-button" data-action="remove-item" type="button" aria-label="Remove item" title="Remove item"><span class="material-symbols-outlined">delete</span></button></div>`;
	}

	contextPopover.innerHTML = `<div class="popover-head"><h2>${heading}</h2><button class="close-button" data-action="close" type="button" aria-label="Close editor">×</button></div>${body}`;
	contextPopover.querySelectorAll('[data-field]').forEach(control => {
		control.addEventListener('input', event => updateActiveField(event.target));
		control.addEventListener('change', event => updateActiveField(event.target));
	});
	contextPopover.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => handleAction(button.dataset.action)));
	contextPopover.querySelector('[data-selection-move]')?.addEventListener('change', event => {
		if (event.target.value !== '') moveSelectedItems(Number(event.target.value));
	});
	animatePopoverHeight(previousHeight);
}

function updateActiveField(control) {
	const target = getActiveTarget();
	const value = control.type === 'checkbox' ? control.checked : (['columns', 'headerColumns', 'span'].includes(control.dataset.field) ? Number(control.value) : control.value);
	if (['header', 'snippet', 'indicator'].includes(activeEditor.type)) state[control.dataset.field] = value;
	else target[control.dataset.field] = value;
	if (activeEditor.type === 'section' && control.dataset.field === 'title' && !value.trim()) {
		promoteSection(activeEditor.sectionIndex);
		recordState();
		render();
		return;
	}
	if (activeEditor.type === 'section' && control.dataset.field === 'columns') target.items.forEach(item => item.span = Math.min(item.span, value));
	if (activeEditor.type === 'header-content' && control.dataset.field === 'headerColumns') state.headerItems.forEach(item => item.span = Math.min(item.span, value));
	if (control.dataset.field === 'span') {
		const spanControlElement = control.closest('.range-control');
		spanControlElement.querySelector('output').textContent = value;
	}
	if (['columns', 'headerColumns'].includes(control.dataset.field)) control.closest('.range-control').querySelector('output').textContent = value;
	recordState();
	renderPreviewAndCode();
	if (activeEditor.type === 'section' && control.dataset.field === 'layout') renderPopover();
}

function handleAction(action) {
	if (action === 'close') {
		contextPopover.classList.remove('is-open');
		return;
	}
	if (action === 'add-item') {
		const items = getItemCollection(activeEditor.sectionIndex);
		items.push(makeEmptyItem());
		activeEditor = { type: 'item', sectionIndex: activeEditor.sectionIndex, itemIndex: items.length - 1 };
	}
	if (action === 'remove-section') {
		state.sections.splice(activeEditor.sectionIndex, 1);
		activeEditor = { type: 'header' };
	}
	if (action === 'remove-item') {
		const items = getItemCollection(activeEditor.sectionIndex);
		items.splice(activeEditor.itemIndex, 1);
		activeEditor = activeEditor.sectionIndex === -1 ? { type: 'header' } : { type: 'section', sectionIndex: activeEditor.sectionIndex };
	}
	if (action === 'remove-selected-items') removeSelectedItems();
	recordState();
	render();
}

function removeSelectedItems() {
	getSelectedLocations()
		.sort((left, right) => right.sectionIndex - left.sectionIndex || right.itemIndex - left.itemIndex)
		.forEach(({ sectionIndex, itemIndex }) => getItemCollection(sectionIndex).splice(itemIndex, 1));
	selectedItemIds.clear();
	activeEditor = { type: 'header' };
}

function moveSelectedItems(destinationIndex) {
	const selectedItems = getSelectedLocations().map(({ item }) => item);
	if (!selectedItems.length) return;
	const selectedIds = new Set(selectedItems.map(item => item.id));
	[state.headerItems, ...state.sections.map(section => section.items)].forEach(items => {
		for (let index = items.length - 1; index >= 0; index -= 1) {
			if (selectedIds.has(items[index].id)) items.splice(index, 1);
		}
	});
	getItemCollection(destinationIndex).push(...selectedItems);
	selectedItemIds.clear();
	activeEditor = destinationIndex === -1 ? { type: 'header' } : { type: 'section', sectionIndex: destinationIndex };
	recordState();
	render();
}

function copyItems() {
	const selectedItems = getSelectedLocations().map(({ item }) => item);
	if (selectedItems.length) {
		copiedItems = selectedItems.map(cloneItem);
		return;
	}
	if (activeEditor.type !== 'item') return;
	const item = getItemCollection(activeEditor.sectionIndex)?.[activeEditor.itemIndex];
	if (item) copiedItems = [cloneItem(item)];
}

function pasteItems() {
	if (!copiedItems.length) return;
	let destinationIndex = -1;
	let insertionIndex;
	if (activeEditor.type === 'item') {
		destinationIndex = activeEditor.sectionIndex;
		insertionIndex = activeEditor.itemIndex + 1;
	} else if (activeEditor.type === 'section') {
		destinationIndex = activeEditor.sectionIndex;
	} else if (activeEditor.type === 'selection') {
		const selection = getSelectedLocations();
		if (selection.length) {
			const lastItem = selection.at(-1);
			destinationIndex = lastItem.sectionIndex;
			insertionIndex = lastItem.itemIndex + 1;
		}
	}
	const destination = getItemCollection(destinationIndex);
	const pastedItems = copiedItems.map(cloneItem);
	destination.splice(insertionIndex ?? destination.length, 0, ...pastedItems);
	setSelectedItems(pastedItems.map(item => item.id));
	activeEditor = pastedItems.length > 1
		? { type: 'selection' }
		: { type: 'item', sectionIndex: destinationIndex, itemIndex: insertionIndex ?? destination.length - 1 };
	recordState();
	render();
}

function createSection() {
	state.sections.push({ title: 'Section title', subtitle: '', layout: 'grid', columns: 2, items: [] });
	recordState();
	renderPreviewAndCode();
	activateEditor('section', state.sections.length - 1);
}

function activateEditor(type, sectionIndex, itemIndex) {
	activeEditor = { type, sectionIndex, itemIndex };
	contextPopover.classList.add('is-open');
	renderPopover();
}

function syncInlineEditor(field, value) {
	const modalField = contextPopover.querySelector(`[data-field="${field}"]`);
	if (modalField && modalField.type !== 'checkbox') modalField.value = value;
	codeOutput.textContent = outputMode === 'template' ? makeTemplate() : makeLua();
}

function startInlineEdit(element) {
	const editor = element.closest('.edit-target');
	const type = element.dataset.inline;
	const sectionIndex = Number(editor.dataset.sectionIndex);
	const section = state.sections[sectionIndex];
	const item = getItemCollection(sectionIndex)?.[Number(editor.dataset.itemIndex)];
	const field = type === 'section-title' || type === 'header-title' ? 'title' : type === 'header-subtitle' ? 'subtitle' : type === 'item-label' ? 'label' : type === 'item-data' ? 'data' : 'indicator';
	const target = type === 'section-title' ? section : type.startsWith('item-') ? item : state;
	if (!target) return;
	const editorInput = document.createElement('input');
	editorInput.className = 'inline-editor';
	editorInput.value = target[field] || '';
	editorInput.required = type === 'section-title';
	element.replaceWith(editorInput);
	editorInput.focus();
	editorInput.select();
	const commit = () => {
		if (type === 'section-title' && !editorInput.value.trim()) {
			promoteSection(sectionIndex);
			recordState();
			render();
			return;
		}
		target[field] = editorInput.value;
		recordState();
		renderPreviewAndCode();
		renderPopover();
	};
	editorInput.addEventListener('input', () => {
		target[field] = editorInput.value;
		if (type === 'section-title' && !editorInput.value.trim()) {
			promoteSection(sectionIndex);
			recordState();
			render();
			return;
		}
		syncInlineEditor(field, editorInput.value);
	});
	editorInput.addEventListener('blur', commit, { once: true });
	editorInput.addEventListener('keydown', event => {
		if (event.key === 'Enter') editorInput.blur();
		if (event.key === 'Escape') {
			event.preventDefault();
			renderPreviewAndCode();
		}
	});
}

function renderItem(item, itemIndex, sectionIndex, layout, columns) {
	const content = layout === 'list'
		? `<span class="ib-data ${item.data ? '' : 'is-placeholder'}" data-inline="item-data">${escapeHtml(item.data || 'Item data')}</span>${item.description ? `<span class="ib-description">${escapeHtml(item.description)}</span>` : ''}`
		: `<span class="ib-label ${item.label ? '' : 'is-placeholder'}" data-inline="item-label">${escapeHtml(item.label || 'Item label')}</span><span class="ib-data ${item.data ? '' : 'is-placeholder'}" data-inline="item-data">${escapeHtml(item.data || 'Item data')}</span>`;
	return `<button class="ib-item ${layout} edit-target ${selectedItemIds.has(item.id) ? 'is-selected' : ''}" data-editor="item" data-item-id="${item.id}" data-section-index="${sectionIndex}" data-item-index="${itemIndex}" style="grid-column:span ${layout === 'grid' ? Math.min(item.span, columns) : columns}" type="button" draggable="true">${content}</button>`;
}

function renderPreviewAndCode() {
	const indicatorColor = state.indicatorClass.replace('infobox__indicator--', '');
	const indicator = `<button class="ib-indicators edit-target ${state.indicator ? '' : 'is-empty'}" data-editor="indicator" type="button"><span class="ib-indicator ${escapeHtml(indicatorColor)}" data-inline="indicator">${escapeHtml(state.indicator || '+ Add indicator')}</span></button>`;
	const snippet = `<button class="ib-snippet edit-target" data-editor="snippet" type="button"><span class="material-symbols-outlined">keyboard_arrow_down</span><span class="ib-snippet-label">Quick facts:</span><span class="ib-snippet-text">${escapeHtml(state.snippet || 'InfoboxNeue')}</span></button>`;
	const header = `<button class="ib-header edit-target" data-editor="header" type="button"><span class="ib-title" data-inline="header-title">${escapeHtml(state.title || 'Title')}</span>${state.subtitle ? `<span class="ib-subtitle" data-inline="header-subtitle">${escapeHtml(state.subtitle)}</span>` : ''}</button>`;
	const headerItems = state.headerItems.map((item, itemIndex) => renderItem(item, itemIndex, -1, 'grid', state.headerColumns)).join('');
	const headerContent = `<div class="ib-main-content edit-target" data-editor="header-content" data-drop-zone="-1" style="--columns:${state.headerColumns}" aria-label="Edit title details">${headerItems}<button class="add-preview-item" data-add-item="-1" type="button">+ Add item</button></div>`;
	const sections = state.sections.map((section, sectionIndex) => {
		const layout = section.layout || 'grid';
		const items = section.items.map((item, itemIndex) => renderItem(item, itemIndex, sectionIndex, layout, section.columns)).join('');
		const addItem = `<button class="add-preview-item" data-add-item="${sectionIndex}" type="button">+ Add item</button>`;
		return `<section class="ib-section"><button class="ib-section-head edit-target" data-editor="section" data-section-index="${sectionIndex}" type="button"><span data-inline="section-title">${escapeHtml(section.title || 'Section title')}</span></button>${section.subtitle ? `<div class="ib-section-subtitle">${escapeHtml(section.subtitle)}</div>` : ''}<div class="ib-section-content ${layout}" data-drop-zone="${sectionIndex}" style="--columns:${section.columns}">${items}${addItem}</div></section>`;
	}).join('');
	preview.innerHTML = `<div class="infobox-neue">${snippet}<article class="infobox-neue-preview"><button class="ib-image edit-target" data-editor="image" type="button"><img src="../../landing/clouds.png" alt="Clouds placeholder"></button>${indicator}${header}${headerContent}${sections}<button class="add-preview-section" id="primaryAddSection" type="button">+ Add section</button></article></div>`;
	preview.querySelectorAll('[data-editor]').forEach(button => button.addEventListener('click', event => {
		if (button.dataset.editor === 'header-content') {
			if (event.target.closest('.ib-item, .add-preview-item')) return;
			activateEditor('header-content');
			return;
		}
		if (button.dataset.editor !== 'item') {
			activateEditor(button.dataset.editor, Number(button.dataset.sectionIndex), Number(button.dataset.itemIndex));
			return;
		}
		const itemId = button.dataset.itemId;
		if (event.ctrlKey || event.metaKey) {
			if (selectedItemIds.has(itemId)) selectedItemIds.delete(itemId);
			else selectedItemIds.add(itemId);
		} else {
			selectedItemIds = new Set([itemId]);
		}
		setSelectedItems(selectedItemIds);
		if (selectedItemIds.size > 1) activateEditor('selection');
		else if (selectedItemIds.size === 1) activateEditor('item', Number(button.dataset.sectionIndex), Number(button.dataset.itemIndex));
		else activateEditor('header');
	}));
	preview.querySelectorAll('[data-add-item]').forEach(button => button.addEventListener('click', () => {
		const sectionIndex = Number(button.dataset.addItem);
		const items = getItemCollection(sectionIndex);
		items.push(makeEmptyItem());
		recordState();
		renderPreviewAndCode();
		activateEditor('item', sectionIndex, items.length - 1);
	}));
	preview.querySelectorAll('.ib-item[draggable="true"]').forEach(item => item.addEventListener('dragstart', event => {
		const itemIds = selectedItemIds.has(item.dataset.itemId)
			? getSelectedLocations().map(({ item: selectedItem }) => selectedItem.id)
			: [item.dataset.itemId];
		event.dataTransfer.setData('text/plain', JSON.stringify({ itemIds }));
		event.dataTransfer.effectAllowed = 'move';
		preview.querySelectorAll('.ib-item').forEach(previewItem => previewItem.classList.toggle('is-dragging', itemIds.includes(previewItem.dataset.itemId)));
		preview.classList.add('is-dragging');
	}));
	preview.querySelectorAll('.ib-item[draggable="true"]').forEach(item => item.addEventListener('dragend', () => {
		preview.querySelectorAll('.is-dragging, .drop-before, .drop-after, .drop-left, .drop-right, .is-drag-target').forEach(element => element.classList.remove('is-dragging', 'drop-before', 'drop-after', 'drop-left', 'drop-right', 'is-drag-target'));
		preview.classList.remove('is-dragging');
	}));
	preview.querySelectorAll('[data-drop-zone]').forEach(zone => {
		zone.addEventListener('dragover', event => {
			event.preventDefault();
			event.dataTransfer.dropEffect = 'move';
			preview.querySelectorAll('.drop-before, .drop-after, .drop-left, .drop-right').forEach(element => element.classList.remove('drop-before', 'drop-after', 'drop-left', 'drop-right'));
			const targetItem = event.target.closest('.ib-item');
			if (!targetItem || !zone.contains(targetItem)) {
				zone.classList.add('is-drag-target');
				return;
			}
			zone.classList.remove('is-drag-target');
			const rect = targetItem.getBoundingClientRect();
			const isGrid = !zone.classList.contains('row') && !zone.classList.contains('list');
			targetItem.classList.add(isGrid
				? (event.clientX < rect.left + rect.width / 2 ? 'drop-left' : 'drop-right')
				: (event.clientY < rect.top + rect.height / 2 ? 'drop-before' : 'drop-after'));
		});
		zone.addEventListener('dragleave', event => {
			if (!zone.contains(event.relatedTarget)) {
				zone.classList.remove('is-drag-target');
				zone.querySelectorAll('.drop-before, .drop-after, .drop-left, .drop-right').forEach(element => element.classList.remove('drop-before', 'drop-after', 'drop-left', 'drop-right'));
			}
		});
		zone.addEventListener('drop', event => {
			event.preventDefault();
			zone.classList.remove('is-drag-target');
			const targetItem = event.target.closest('.ib-item');
			const source = JSON.parse(event.dataTransfer.getData('text/plain'));
			const itemIds = new Set(source.itemIds || []);
			if (!itemIds.size || (targetItem && itemIds.has(targetItem.dataset.itemId))) return;
			const movedItems = getItemLocations().filter(({ item }) => itemIds.has(item.id)).map(({ item }) => item);
			if (!movedItems.length) return;
			let insertAfter = false;
			if (targetItem) {
				const rect = targetItem.getBoundingClientRect();
				const isGrid = !zone.classList.contains('row') && !zone.classList.contains('list');
				insertAfter = isGrid ? event.clientX >= rect.left + rect.width / 2 : event.clientY >= rect.top + rect.height / 2;
			}
			[state.headerItems, ...state.sections.map(section => section.items)].forEach(items => {
				for (let index = items.length - 1; index >= 0; index -= 1) {
					if (itemIds.has(items[index].id)) items.splice(index, 1);
				}
			});
			const targetItems = getItemCollection(Number(zone.dataset.dropZone));
			const targetIndex = targetItem && zone.contains(targetItem)
				? targetItems.findIndex(item => item.id === targetItem.dataset.itemId) + (insertAfter ? 1 : 0)
				: targetItems.length;
			targetItems.splice(Math.max(0, targetIndex), 0, ...movedItems);
			recordState();
			render();
		});
	});
	const primaryAddSection = document.getElementById('primaryAddSection');
	primaryAddSection.addEventListener('click', createSection);
	observePrimaryAddSection(primaryAddSection);
	preview.querySelectorAll('[data-inline]').forEach(element => element.addEventListener('dblclick', event => {
		event.preventDefault();
		event.stopPropagation();
		startInlineEdit(element);
	}));
	bindSelectionBox();
	codeOutput.textContent = outputMode === 'template' ? makeTemplate() : makeLua();
	codeDescription.textContent = outputMode === 'template' ? 'Ready to paste into a wiki template' : 'Ready to paste into a wiki module';
}

function bindSelectionBox() {
	preview.addEventListener('pointerdown', event => {
		if (event.button !== 0 || event.target.closest('button, input, select, textarea, [data-editor="header-content"]')) return;
		const box = document.createElement('div');
		box.className = 'selection-box';
		preview.append(box);
		selectionGesture = {
			box,
			startX: event.clientX,
			startY: event.clientY,
			initialSelection: event.ctrlKey || event.metaKey ? new Set(selectedItemIds) : new Set()
		};
		preview.setPointerCapture(event.pointerId);
	});

	preview.addEventListener('pointermove', event => {
		if (!selectionGesture) return;
		const left = Math.min(selectionGesture.startX, event.clientX);
		const top = Math.min(selectionGesture.startY, event.clientY);
		const width = Math.abs(event.clientX - selectionGesture.startX);
		const height = Math.abs(event.clientY - selectionGesture.startY);
		Object.assign(selectionGesture.box.style, { left: `${left - preview.getBoundingClientRect().left}px`, top: `${top - preview.getBoundingClientRect().top}px`, width: `${width}px`, height: `${height}px` });
		const selectedIds = new Set(selectionGesture.initialSelection);
		preview.querySelectorAll('.ib-item').forEach(item => {
			const rect = item.getBoundingClientRect();
			const intersects = rect.right >= left && rect.left <= left + width && rect.bottom >= top && rect.top <= top + height;
			if (intersects) selectedIds.add(item.dataset.itemId);
		});
		setSelectedItems(selectedIds);
	});

	preview.addEventListener('pointerup', event => {
		if (!selectionGesture) return;
		selectionGesture.box.remove();
		selectionGesture = undefined;
		if (preview.hasPointerCapture(event.pointerId)) preview.releasePointerCapture(event.pointerId);
		if (selectedItemIds.size > 1) activateEditor('selection');
	});
}

function makeTemplate() {
	const lines = ['{{InfoboxNeue', `| snippet = ${state.snippet}`, `| title = ${state.title || '{{PAGENAME}}'}`, `| subtitle = ${state.subtitle}`, '| image = Clouds.png'];
	lines.push(`| col = ${state.headerColumns}`);
	if (state.indicator) {
		lines.push(`| indicator = ${state.indicator}`);
		if (state.indicatorClass) lines.push(`| indicatorClass = ${state.indicatorClass}`);
	}
	let sectionNumber = 1;
	let itemNumber = 1;
	function appendItems(items) {
		items.filter(item => item.label || item.data).forEach(item => {
			lines.push(`| label${itemNumber} = ${item.label || ''}`);
			lines.push(`| content${itemNumber} = ${item.data || ''}`);
			itemNumber += 1;
		});
	}
	appendItems(state.headerItems);
	state.sections.forEach(section => {
		lines.push(`| section${sectionNumber} = ${section.title}`);
		lines.push(`| section-col${sectionNumber} = ${section.columns}`);
		sectionNumber += 1;
		appendItems(section.items);
	});
	lines.push('}}');
	return lines.join('\n');
}

function makeLua() {
	const lines = ["local p = {}", "local InfoboxNeue = require('Module:InfoboxNeue')", '', 'function p.main()', '\tlocal infobox = InfoboxNeue:new()', '', "\tinfobox:renderImage( 'Clouds.png' )", ''];
	if (state.indicator) lines.push('\tinfobox:renderIndicator( {', `\t\tdata = ${luaString(state.indicator)},`, ...(state.indicatorClass ? [`\t\tclass = ${luaString(state.indicatorClass)},`] : []), '\t} )', '');
	lines.push('\tinfobox:renderHeader( {', `\t\ttitle = ${luaString(state.title || 'Title')},`, ...(state.subtitle ? [`\t\tsubtitle = ${luaString(state.subtitle)},`] : []), '\t} )', '');
	if (state.headerItems.length) {
		lines.push('\tdo', '\t\tlocal headerRows = {}');
		state.headerItems.forEach(item => lines.push('\t\ttable.insert( headerRows, infobox:renderItem( {', ...(item.label ? [`\t\t\tlabel = ${luaString(item.label)},`] : []), `\t\t\tdata = ${luaString(item.data || '')},`, ...(item.span > 1 ? [`\t\t\tcolspan = ${item.span},`] : []), '\t\t} ) )'));
		lines.push('\t\tinfobox:renderSection( {', '\t\t\tcontent = table.concat( headerRows ),', `\t\t\tcol = ${state.headerColumns},`, '\t\t} )', '\tend', '');
	}
	state.sections.forEach(section => {
		lines.push('\tdo', '\t\tlocal sectionRows = {}');
		section.items.filter(item => item.label || item.data).forEach(item => lines.push('\t\ttable.insert( sectionRows, infobox:renderItem( {', ...(section.layout === 'list' ? [] : item.label ? [`\t\t\tlabel = ${luaString(item.label)},`] : []), `\t\t\tdata = ${luaString(item.data || '')},`, ...(section.layout === 'list' && item.description ? [`\t\t\tdesc = ${luaString(item.description)},`] : []), ...(section.layout === 'row' ? ['\t\t\trow = true,', '\t\t\tspacebetween = true,'] : []), ...(section.layout === 'grid' && item.span > 1 ? [`\t\t\tcolspan = ${item.span},`] : []), '\t\t} ) )'));
		lines.push('\t\tinfobox:renderSection( {', ...(section.title ? [`\t\t\ttitle = ${luaString(section.title)},`] : []), ...(section.subtitle ? [`\t\t\tsubtitle = ${luaString(section.subtitle)},`] : []), '\t\t\tcontent = table.concat( sectionRows ),', ...(section.columns > 1 ? [`\t\t\tcol = ${section.columns},`] : []), '\t\t} )', '\tend', '');
	});
	lines.push(`\treturn infobox:renderInfobox( nil, ${state.snippet ? luaString(state.snippet) : 'nil'} )`, 'end', '', 'return p');
	return lines.join('\n');
}

function setOutputMode(mode) {
	outputMode = mode;
	const isTemplate = mode === 'template';
	templateTab.classList.toggle('active', isTemplate);
	moduleTab.classList.toggle('active', !isTemplate);
	templateTab.setAttribute('aria-selected', String(isTemplate));
	moduleTab.setAttribute('aria-selected', String(!isTemplate));
	renderPreviewAndCode();
}

function render() {
	renderPreviewAndCode();
	renderPopover();
}

function observePrimaryAddSection(button) {
	if (!window.IntersectionObserver) return;
	primaryAddSectionObserver?.disconnect();
	const observer = new IntersectionObserver(([entry]) => {
		stickyAddSection.hidden = entry.isIntersecting;
	}, { threshold: 0.1 });
	observer.observe(button);
	primaryAddSectionObserver = observer;
}

templateTab.addEventListener('click', () => setOutputMode('template'));
moduleTab.addEventListener('click', () => setOutputMode('module'));
document.getElementById('resetButton').addEventListener('click', () => {
	state = structuredClone(initialState);
	ensureItemIds();
	selectedItemIds.clear();
	recordState();
	activeEditor = { type: 'header' };
	contextPopover.classList.remove('is-open');
	render();
});
stickyAddSection.addEventListener('click', createSection);
document.getElementById('copyButton').addEventListener('click', async event => {
	const icon = event.currentTarget.querySelector('.material-symbols-outlined');
	try {
		await navigator.clipboard.writeText(codeOutput.textContent);
		icon.textContent = 'check';
		setTimeout(() => { icon.textContent = 'content_copy'; }, 1100);
	} catch {
		icon.textContent = 'error';
		setTimeout(() => { icon.textContent = 'content_copy'; }, 1100);
	}
});
document.addEventListener('keydown', event => {
	const isTextInput = event.target.matches('input, select, textarea, [contenteditable="true"]');
	if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
		event.preventDefault();
		if (event.shiftKey) redo();
		else undo();
		return;
	}
	if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
		event.preventDefault();
		redo();
		return;
	}
	if (isTextInput) return;
	if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
		event.preventDefault();
		copyItems();
		return;
	}
	if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') {
		event.preventDefault();
		pasteItems();
		return;
	}
	if (['Backspace', 'Delete'].includes(event.key) && selectedItemIds.size > 1) {
		event.preventDefault();
		removeSelectedItems();
		recordState();
		render();
		return;
	}
	if (activeEditor.type !== 'item') return;
	const items = getItemCollection(activeEditor.sectionIndex);
	const item = items?.[activeEditor.itemIndex];
	if (!item) return;
	if (['Backspace', 'Delete'].includes(event.key)) {
		event.preventDefault();
		items.splice(activeEditor.itemIndex, 1);
		activeEditor = activeEditor.sectionIndex === -1 ? { type: 'header' } : { type: 'section', sectionIndex: activeEditor.sectionIndex };
		recordState();
		render();
	}
	if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
		event.preventDefault();
		items.splice(activeEditor.itemIndex + 1, 0, cloneItem(item));
		activeEditor.itemIndex += 1;
		recordState();
		render();
	}
});
ensureItemIds();
history = [structuredClone(state)];
render();
