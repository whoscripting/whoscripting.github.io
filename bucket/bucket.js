document.addEventListener("DOMContentLoaded", () => {
    const schemaInput = document.getElementById("schemaInput");
    const schemaOutput = document.getElementById("schemaOutput");
    const schemaDiagnostics = document.getElementById("schemaDiagnostics");
    const copySchemaButton = document.getElementById("copySchemaButton");

    const storeInput = document.getElementById("storeInput");
    const storeOutput = document.getElementById("storeOutput");
    const storeDiagnostics = document.getElementById("storeDiagnostics");
    const copyStoreButton = document.getElementById("copyStoreButton");

    // -------------------------------------------------------------
    // Helper: Map Cargo type to Bucket type
    // -------------------------------------------------------------
    function mapCargoType(cargoType) {
        const cleanType = cargoType.trim().toLowerCase();
        switch (cleanType) {
            case 'page':
                return { type: 'PAGE' };
            case 'string':
            case 'text':
                return { type: 'TEXT', index: false };
            case 'integer':
                return { type: 'INTEGER' };
            case 'float':
            case 'double':
                return { type: 'DOUBLE' };
            case 'boolean':
                return { type: 'BOOLEAN' };
            case 'wikitext string':
                return { type: 'TEXT' };
            case 'wikitext':
                return { type: 'TEXT', index: false };
            case 'searchtext':
                return { type: 'TEXT' };
            case 'file':
                return { type: 'PAGE' };
            case 'url':
            case 'email':
                return { type: 'TEXT' };
            case 'rating':
                return { type: 'INTEGER' };
            case 'date':
            case 'start date':
            case 'end date':
            case 'datetime':
            case 'start datetime':
            case 'end datetime':
                // ISO 8601 representation
                return { type: 'TEXT', index: false };
            case 'coordinates':
                return { type: 'TEXT', index: false };
            default:
                return null;
        }
    }

    // -------------------------------------------------------------
    // Schema Conversion Logic
    // -------------------------------------------------------------
    function convertSchema() {
        const inputText = schemaInput.value;
        if (!inputText.trim()) {
            schemaOutput.textContent = "Output will appear here...";
            schemaDiagnostics.style.display = "none";
            return;
        }

        const lines = inputText.split("\n");
        const schema = {};
        const warnings = [];
        const errors = [];
        let hasCargoDeclare = false;

        const fieldRegex = /^\s*\|?\s*([a-zA-Z0-9_\-]+)\s*[-=:]\s*(.+)$/;

        lines.forEach((line, idx) => {
            const trimmed = line.trim();
            if (!trimmed) return;

            // Check if #cargo_declare is in the input
            if (trimmed.toLowerCase().includes("#cargo_declare")) {
                hasCargoDeclare = true;
                return;
            }

            // Skip template close double curly braces
            if (trimmed === "}}" || trimmed === "}}}") {
                return;
            }

            const match = trimmed.match(fieldRegex);
            if (match) {
                const rawField = match[1].trim();
                const rawType = match[2].trim();

                // Validate numbers-only parameter names
                const isNumeric = /^\d+$/.test(rawField);
                if (isNumeric) {
                    errors.push(`Line ${idx + 1}: Parameter name "${rawField}" is numbers-only. Bucket parameter names must contain word characters.`);
                }

                // Map Cargo type to Bucket type
                const bucketType = mapCargoType(rawType);
                if (bucketType) {
                    schema[rawField] = bucketType;
                } else {
                    // Default fallback
                    schema[rawField] = { type: 'TEXT', index: false };
                    warnings.push(`Line ${idx + 1}: Unrecognized Cargo type "${rawType}". Defaulted to TEXT (no index).`);
                }
            } else {
                // If it's not a comment or template bracket, warn about formatting
                if (!trimmed.startsWith("<!--") && !trimmed.startsWith("{{") && !trimmed.startsWith("}}")) {
                    warnings.push(`Line ${idx + 1}: Could not parse "${trimmed}". Ensure format is "fieldname - type".`);
                }
            }
        });

        // Add cargo_declare note warning if detected
        if (hasCargoDeclare) {
            warnings.push("Notice: '#cargo_declare' declaration was detected. This should be removed from your MediaWiki setup as Bucket does not use it.");
        }

        // Render JSON Output
        schemaOutput.textContent = JSON.stringify(schema, null, 4);

        // Display diagnostics
        renderDiagnostics(schemaDiagnostics, errors, warnings);
    }

    // -------------------------------------------------------------
    // Store Conversion Logic
    // -------------------------------------------------------------
    function convertStore() {
        const inputText = storeInput.value;
        if (!inputText.trim()) {
            storeOutput.textContent = "Output will appear here...";
            storeDiagnostics.style.display = "none";
            return;
        }

        const warnings = [];
        const errors = [];
        let convertedCode = "";

        // Find the start of the cargo_store call
        const match = inputText.match(/\{\{\s*#cargo_store\s*:/i);
        if (match) {
            const startIndex = match.index;
            const contentStart = startIndex + match[0].length;
            let depth = 2; // For the initial outer "{{"
            let endIndex = -1;

            for (let i = contentStart; i < inputText.length; i++) {
                const c = inputText[i];
                if (c === '{') {
                    depth++;
                } else if (c === '}') {
                    depth--;
                }
                if (depth === 0) {
                    endIndex = i;
                    break;
                }
            }

            if (endIndex === -1) {
                errors.push("Template syntax error: Unbalanced curly braces. Make sure the '{{#cargo_store:' call has matching closing '}}'.");
                storeOutput.textContent = "Syntax Error: Unbalanced braces.";
                renderDiagnostics(storeDiagnostics, errors, warnings);
                return;
            }

            const innerContent = inputText.substring(contentStart, endIndex - 1);
            const params = parseCargoParams(innerContent);

            let tableName = "unknown";
            const tableParam = params.find(p => p.key.toLowerCase() === "_table");
            if (tableParam) {
                tableName = tableParam.value.trim().toLowerCase();
            } else {
                warnings.push("Missing '_table' parameter in cargo_store call. Defaulted to 'unknown'.");
            }

            // Build Bucket template invocation
            let result = `{{#invoke:Bucket|put|${tableName}\n`;

            params.forEach(p => {
                if (p.key.toLowerCase() === "_table") return; // Skip table parameter in values

                // Check numbers-only parameter names
                const isNumeric = /^\d+$/.test(p.key);
                if (isNumeric) {
                    errors.push(`Parameter "${p.key}" is numbers-only. Bucket parameters must contain words (e.g. rename to "landscapeimage").`);
                }

                result += `    | ${p.key} = ${p.value}\n`;
            });

            result += "}}";
            convertedCode = result;
        } else {
            // Fallback: Parse as raw parameter lines if no template call is matched
            warnings.push("Note: No '{{#cargo_store:' declaration found. Attempting to parse lines as raw parameters.");
            const lines = inputText.split("\n");
            let result = "{{#invoke:Bucket|put|tableName\n";
            
            lines.forEach((line, idx) => {
                const trimmed = line.trim();
                if (!trimmed) return;
                
                // Strip leading pipe if present
                const cleanLine = trimmed.startsWith("|") ? trimmed.substring(1).trim() : trimmed;
                const eqIdx = cleanLine.indexOf("=");
                if (eqIdx !== -1) {
                    const key = cleanLine.substring(0, eqIdx).trim();
                    const value = cleanLine.substring(eqIdx + 1).trim();

                    if (/^\d+$/.test(key)) {
                        errors.push(`Line ${idx + 1}: Parameter "${key}" is numbers-only.`);
                    }

                    result += `    | ${key} = ${value}\n`;
                }
            });
            result += "}}";
            convertedCode = result;
        }

        storeOutput.textContent = convertedCode;
        renderDiagnostics(storeDiagnostics, errors, warnings);
    }

    // Parse cargo parameters robustly using depth tracking for nested brackets
    function parseCargoParams(text) {
        const params = [];
        let current = "";
        let depth = 0;

        for (let i = 0; i < text.length; i++) {
            const c = text[i];
            if (c === '{') {
                depth++;
                current += c;
            } else if (c === '}') {
                depth--;
                current += c;
            } else if (c === '|' && depth === 0) {
                addParam(current);
                current = "";
            } else {
                current += c;
            }
        }
        if (current.trim()) {
            addParam(current);
        }

        function addParam(paramStr) {
            const trimmed = paramStr.trim();
            if (!trimmed) return;

            let eqDepth = 0;
            let eqIndex = -1;
            for (let j = 0; j < trimmed.length; j++) {
                const char = trimmed[j];
                if (char === '{') {
                    eqDepth++;
                } else if (char === '}') {
                    eqDepth--;
                } else if (char === '=' && eqDepth === 0) {
                    eqIndex = j;
                    break;
                }
            }

            if (eqIndex === -1) {
                params.push({ key: trimmed, value: "" });
            } else {
                params.push({
                    key: trimmed.substring(0, eqIndex).trim(),
                    value: trimmed.substring(eqIndex + 1).trim()
                });
            }
        }

        return params;
    }

    // -------------------------------------------------------------
    // Helper: Display warnings and errors in UI
    // -------------------------------------------------------------
    function renderDiagnostics(container, errors, warnings) {
        if (errors.length === 0 && warnings.length === 0) {
            container.style.display = "none";
            container.innerHTML = "";
            return;
        }

        container.style.display = "block";
        let html = "";

        if (errors.length > 0) {
            html += `<div style="color: var(--danger); font-weight: bold; font-size: 0.9rem; margin-bottom: 6px;">Errors:</div>`;
            html += `<ul style="margin: 0 0 10px 0; padding-left: 20px; color: var(--danger); font-size: 0.85rem; line-height: 1.45;">`;
            errors.forEach(e => {
                html += `<li>${escapeHtml(e)}</li>`;
            });
            html += `</ul>`;
        }

        if (warnings.length > 0) {
            html += `<ul style="margin: 0; padding-left: 20px; color: var(--muted); font-size: 0.85rem; line-height: 1.45;">`;
            warnings.forEach(w => {
                html += `<li>${escapeHtml(w)}</li>`;
            });
            html += `</ul>`;
        }

        container.innerHTML = html;
    }

    function escapeHtml(str) {
        return str
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    // -------------------------------------------------------------
    // Copy to Clipboard Helpers
    // -------------------------------------------------------------
    function setupCopyButton(button, outputElement) {
        button.addEventListener("click", () => {
            const textToCopy = outputElement.textContent;
            if (!textToCopy || textToCopy.startsWith("Output will appear") || textToCopy.startsWith("Syntax Error")) {
                return;
            }

            const copyIcon = button.querySelector(".material-symbols-outlined");

            navigator.clipboard.writeText(textToCopy).then(() => {
                copyIcon.textContent = "check";

                setTimeout(() => {
                    copyIcon.textContent = "content_copy";
                }, 1100);
            }).catch(err => {
                console.error("Clipboard copy failed: ", err);
                alert("Failed to copy to clipboard.");
            });
        });
    }

    // Event Listeners for inputs
    schemaInput.addEventListener("input", convertSchema);
    storeInput.addEventListener("input", convertStore);

    // Setup copy action handlers
    setupCopyButton(copySchemaButton, schemaOutput);
    setupCopyButton(copyStoreButton, storeOutput);

    // Run conversions on page load to handle default values/placeholders
    convertSchema();
    convertStore();
});
