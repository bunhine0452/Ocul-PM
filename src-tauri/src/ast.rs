use std::path::Path;
use serde::Serialize;
use tree_sitter::{Parser, Query, QueryCursor};

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct SymbolDef {
    pub name: String,
    pub kind: String,
    pub start_line: u32,
    pub end_line: u32,
    pub start_byte: u32,
    pub end_byte: u32,
}

#[derive(Debug, Clone)]
pub struct AstAnalysis {
    pub symbols: Vec<SymbolDef>,
    pub imports: Vec<String>,
}

/// Analyze source code file and extract high-level symbol definitions and imports.
pub fn analyze_file(path: &Path, content: &str) -> Option<AstAnalysis> {
    let extension = path.extension()?.to_str()?.to_lowercase();
    
    // Select the language parser and query string based on the extension
    let (lang, query_str) = match extension.as_str() {
        "rs" => {
            let lang = tree_sitter_rust::LANGUAGE.into();
            let query = r#"
                (struct_item name: (type_identifier) @name) @struct
                (enum_item name: (type_identifier) @name) @enum
                (trait_item name: (type_identifier) @name) @trait
                (function_item name: (identifier) @name) @function
                (impl_item type: (type_identifier) @name) @impl
                (use_declaration argument: (_) @import) @use
            "#;
            (lang, query)
        }
        "py" => {
            let lang = tree_sitter_python::LANGUAGE.into();
            let query = r#"
                (class_definition name: (identifier) @name) @class
                (function_definition name: (identifier) @name) @function
                (import_statement name: (_) @import) @import
                (import_from_statement module: (_) @import) @import
            "#;
            (lang, query)
        }
        "js" | "jsx" | "mjs" | "cjs" => {
            let lang = tree_sitter_javascript::LANGUAGE.into();
            let query = r#"
                (class_declaration name: (identifier) @name) @class
                (function_declaration name: (identifier) @name) @function
                (method_definition name: (property_identifier) @name) @method
                (lexical_declaration (variable_declarator name: (identifier) @name value: [(arrow_function) (function_expression)])) @function
                (import_statement source: (string) @import) @import
            "#;
            (lang, query)
        }
        "ts" => {
            let lang = tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into();
            let query = r#"
                (class_declaration name: (identifier) @name) @class
                (interface_declaration name: (type_identifier) @name) @interface
                (function_declaration name: (identifier) @name) @function
                (method_definition name: (property_identifier) @name) @method
                (lexical_declaration (variable_declarator name: (identifier) @name value: [(arrow_function) (function_expression)])) @function
                (import_statement source: (string) @import) @import
            "#;
            (lang, query)
        }
        "tsx" => {
            let lang = tree_sitter_typescript::LANGUAGE_TSX.into();
            let query = r#"
                (class_declaration name: (identifier) @name) @class
                (interface_declaration name: (type_identifier) @name) @interface
                (function_declaration name: (identifier) @name) @function
                (method_definition name: (property_identifier) @name) @method
                (lexical_declaration (variable_declarator name: (identifier) @name value: [(arrow_function) (function_expression)])) @function
                (import_statement source: (string) @import) @import
            "#;
            (lang, query)
        }
        "go" => {
            let lang = tree_sitter_go::LANGUAGE.into();
            let query = r#"
                (type_spec name: (type_identifier) @name) @type
                (function_declaration name: (identifier) @name) @function
                (method_declaration name: (field_identifier) @name) @method
                (import_spec path: (string_literal) @import) @import
            "#;
            (lang, query)
        }
        _ => return None,
    };

    let mut parser = Parser::new();
    if parser.set_language(&lang).is_err() {
        return None;
    }

    let tree = parser.parse(content, None)?;
    let root_node = tree.root_node();

    let query = Query::new(&lang, query_str).ok()?;
    let mut cursor = QueryCursor::new();
    let matches = cursor.matches(&query, root_node, content.as_bytes());

    let mut symbols = Vec::new();
    let mut imports = Vec::new();

    for m in matches {
        let mut name = None;
        let mut kind = "unknown".to_string();
        let mut node_for_range = None;
        let mut import_val = None;

        for capture in m.captures {
            let capture_name: &str = &query.capture_names()[capture.index as usize];
            let captured_node = capture.node;

            match capture_name {
                "name" => {
                    if let Ok(text) = captured_node.utf8_text(content.as_bytes()) {
                        name = Some(text.to_string());
                    }
                }
                "import" => {
                    if let Ok(text) = captured_node.utf8_text(content.as_bytes()) {
                        // Clean quotes and spaces
                        let cleaned = text.trim_matches(|c| c == '"' || c == '\'' || c == '`').trim().to_string();
                        if !cleaned.is_empty() {
                            import_val = Some(cleaned);
                        }
                    }
                }
                // Specific kinds
                "struct" | "enum" | "trait" | "function" | "class" | "interface" | "type" | "method" | "impl" => {
                    kind = capture_name.to_string();
                    node_for_range = Some(captured_node);
                }
                _ => {}
            }
        }

        if let Some(imp) = import_val {
            imports.push(imp);
        } else if let (Some(n), Some(node)) = (name, node_for_range) {
            let start_pos = node.start_position();
            let end_pos = node.end_position();
            
            // Avoid creating duplicate symbol definitions for the same line/node
            symbols.push(SymbolDef {
                name: n,
                kind,
                start_line: (start_pos.row + 1) as u32,
                end_line: (end_pos.row + 1) as u32,
                start_byte: node.start_byte() as u32,
                end_byte: node.end_byte() as u32,
            });
        }
    }

    Some(AstAnalysis { symbols, imports })
}
