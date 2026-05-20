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
///
/// Languages covered:
/// - Tree-sitter (full AST): Rust, Python, JavaScript, TypeScript, TSX, Go
/// - Line-based parsers: Java, Kotlin, C/C++, Ruby, PHP, C#, Swift
pub fn analyze_file(path: &Path, content: &str) -> Option<AstAnalysis> {
    let extension = path.extension()?.to_str()?.to_lowercase();

    // Line-based parsers handle languages without bundled tree-sitter crates
    match extension.as_str() {
        "java" => return Some(analyze_java(content)),
        "kt" | "kts" => return Some(analyze_kotlin(content)),
        "c" | "h" | "cpp" | "cc" | "cxx" | "hpp" | "hxx" | "hh" => {
            return Some(analyze_c_family(content));
        }
        "rb" => return Some(analyze_ruby(content)),
        "php" => return Some(analyze_php(content)),
        "cs" => return Some(analyze_csharp(content)),
        "swift" => return Some(analyze_swift(content)),
        _ => {}
    }

    // Tree-sitter languages
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
            // Note: field name on `import_from_statement` is `module_name`, not `module`.
            let query = r#"
                (class_definition name: (identifier) @name) @class
                (function_definition name: (identifier) @name) @function
                (import_statement name: (_) @import) @import
                (import_from_statement module_name: (_) @import) @import
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
                (call_expression function: (identifier) @_fn arguments: (arguments (string) @import) (#eq? @_fn "require")) @require
            "#;
            (lang, query)
        }
        "ts" => {
            let lang = tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into();
            let query = r#"
                (class_declaration name: (type_identifier) @name) @class
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
                (class_declaration name: (type_identifier) @name) @class
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
                        let mut cleaned = text
                            .trim_matches(|c| c == '"' || c == '\'' || c == '`')
                            .trim()
                            .to_string();
                        // Strip ` as alias` (Python `import foo as f`)
                        if let Some(pos) = cleaned.find(" as ") {
                            cleaned.truncate(pos);
                        }
                        if !cleaned.is_empty() {
                            import_val = Some(cleaned);
                        }
                    }
                }
                "struct" | "enum" | "trait" | "function" | "class" | "interface" | "type"
                | "method" | "impl" => {
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

// --- Line-based parsers --------------------------------------------------

fn push_symbol(symbols: &mut Vec<SymbolDef>, name: String, kind: &str, line_num: u32) {
    if name.is_empty() {
        return;
    }
    symbols.push(SymbolDef {
        name,
        kind: kind.to_string(),
        start_line: line_num,
        end_line: line_num,
        start_byte: 0,
        end_byte: 0,
    });
}

/// Take the leading identifier-like chars from a string.
fn take_ident(raw: &str) -> String {
    raw.chars()
        .take_while(|c| c.is_alphanumeric() || *c == '_' || *c == '$')
        .collect()
}

fn analyze_java(content: &str) -> AstAnalysis {
    let mut symbols = Vec::new();
    let mut imports = Vec::new();

    for (idx, line) in content.lines().enumerate() {
        let line_num = (idx + 1) as u32;
        let trimmed = line.trim();

        // import com.foo.Bar;
        // import static com.foo.Bar.method;
        // import com.foo.*;  (wildcards skipped — no single file target)
        if let Some(rest) = trimmed.strip_prefix("import ") {
            if let Some(body) = rest.strip_suffix(';') {
                let mut imp = body.trim();
                if let Some(s) = imp.strip_prefix("static ") {
                    imp = s.trim();
                    // For static imports, last segment is the member name; drop it
                    if let Some(pos) = imp.rfind('.') {
                        let cls = &imp[..pos];
                        if !cls.is_empty() && !cls.ends_with(".*") {
                            imports.push(cls.to_string());
                        }
                    }
                } else if !imp.is_empty() && !imp.ends_with(".*") {
                    imports.push(imp.to_string());
                }
                continue;
            }
        }

        // class / interface / enum / record by word boundary
        let words: Vec<&str> = trimmed.split_whitespace().collect();
        for (i, w) in words.iter().enumerate() {
            let kind = match *w {
                "class" => Some("class"),
                "interface" => Some("interface"),
                "enum" => Some("enum"),
                "record" => Some("record"),
                _ => None,
            };
            if let Some(k) = kind {
                if let Some(next) = words.get(i + 1) {
                    push_symbol(&mut symbols, take_ident(next), k, line_num);
                }
            }
        }
    }

    AstAnalysis { symbols, imports }
}

fn analyze_kotlin(content: &str) -> AstAnalysis {
    let mut symbols = Vec::new();
    let mut imports = Vec::new();

    for (idx, line) in content.lines().enumerate() {
        let line_num = (idx + 1) as u32;
        let trimmed = line.trim();

        // import com.foo.Bar
        // import com.foo.Bar as Alias
        // import com.foo.*  (skipped)
        if let Some(rest) = trimmed.strip_prefix("import ") {
            let mut imp = rest.trim_end_matches(';').trim();
            if let Some(pos) = imp.find(" as ") {
                imp = &imp[..pos];
            }
            let imp = imp.trim();
            if !imp.is_empty() && !imp.ends_with(".*") {
                imports.push(imp.to_string());
            }
            continue;
        }

        let words: Vec<&str> = trimmed.split_whitespace().collect();
        for (i, w) in words.iter().enumerate() {
            let kind = match *w {
                "class" => Some("class"),
                "interface" => Some("interface"),
                "object" => Some("object"),
                "fun" => Some("function"),
                _ => None,
            };
            if let Some(k) = kind {
                if let Some(next) = words.get(i + 1) {
                    push_symbol(
                        &mut symbols,
                        next.chars()
                            .take_while(|c| c.is_alphanumeric() || *c == '_' || *c == '`')
                            .collect(),
                        k,
                        line_num,
                    );
                }
            }
        }
    }

    AstAnalysis { symbols, imports }
}

fn analyze_c_family(content: &str) -> AstAnalysis {
    let mut symbols = Vec::new();
    let mut imports = Vec::new();

    for (idx, line) in content.lines().enumerate() {
        let line_num = (idx + 1) as u32;
        let trimmed = line.trim();

        // #include "foo.h"  → tracked as relative project import
        // #include <foo.h>  → system header, skipped
        if let Some(rest) = trimmed.strip_prefix("#include") {
            let rest = rest.trim_start();
            if let Some(after_quote) = rest.strip_prefix('"') {
                if let Some(inner) = after_quote.split_once('"').map(|p| p.0) {
                    let inner = inner.trim();
                    if !inner.is_empty() {
                        // Treat as path-relative-to-file
                        imports.push(if inner.starts_with('.') {
                            inner.to_string()
                        } else {
                            format!("./{}", inner)
                        });
                    }
                }
            }
            continue;
        }

        let words: Vec<&str> = trimmed.split_whitespace().collect();
        for (i, w) in words.iter().enumerate() {
            let kind = match *w {
                "class" => Some("class"),
                "struct" => Some("struct"),
                "union" => Some("union"),
                _ => None,
            };
            if let Some(k) = kind {
                if let Some(next) = words.get(i + 1) {
                    // Skip forward declarations like `class Foo;`
                    let name = take_ident(next);
                    let next_after = next.trim_start_matches(&name[..]);
                    if next_after.starts_with(';') {
                        continue;
                    }
                    push_symbol(&mut symbols, name, k, line_num);
                }
            }
        }
    }

    AstAnalysis { symbols, imports }
}

fn analyze_ruby(content: &str) -> AstAnalysis {
    let mut symbols = Vec::new();
    let mut imports = Vec::new();

    for (idx, line) in content.lines().enumerate() {
        let line_num = (idx + 1) as u32;
        let trimmed = line.trim();

        let mut consumed = false;
        for (prefix, relative) in &[("require_relative ", true), ("require ", false)] {
            if let Some(rest) = trimmed.strip_prefix(prefix) {
                let inner = rest
                    .trim()
                    .trim_matches(|c: char| c == '"' || c == '\'' || c == '(' || c == ')')
                    .trim();
                if !inner.is_empty() {
                    imports.push(if *relative {
                        format!("./{}", inner)
                    } else {
                        inner.to_string()
                    });
                }
                consumed = true;
                break;
            }
        }
        if consumed {
            continue;
        }

        let words: Vec<&str> = trimmed.split_whitespace().collect();
        for (i, w) in words.iter().enumerate() {
            let kind = match *w {
                "class" => Some("class"),
                "module" => Some("module"),
                "def" => Some("function"),
                _ => None,
            };
            if let Some(k) = kind {
                if let Some(next) = words.get(i + 1) {
                    push_symbol(
                        &mut symbols,
                        next.chars()
                            .take_while(|c| c.is_alphanumeric() || *c == '_' || *c == '?' || *c == '!')
                            .collect(),
                        k,
                        line_num,
                    );
                }
            }
        }
    }

    AstAnalysis { symbols, imports }
}

fn analyze_php(content: &str) -> AstAnalysis {
    let mut symbols = Vec::new();
    let mut imports = Vec::new();

    for (idx, line) in content.lines().enumerate() {
        let line_num = (idx + 1) as u32;
        let trimmed = line.trim();

        // use Namespace\Class;
        // use Namespace\Class as Alias;
        if let Some(rest) = trimmed.strip_prefix("use ") {
            if let Some(body) = rest.strip_suffix(';') {
                let mut imp = body.trim();
                if let Some(pos) = imp.find(" as ") {
                    imp = &imp[..pos];
                }
                let imp_norm = imp.replace('\\', "/");
                let imp_norm = imp_norm.trim_start_matches('/').trim();
                if !imp_norm.is_empty() && !imp_norm.ends_with("*") {
                    imports.push(imp_norm.to_string());
                }
                continue;
            }
        }

        // require/include 'file.php';
        let mut consumed = false;
        for prefix in &[
            "require_once ",
            "require ",
            "include_once ",
            "include ",
        ] {
            if let Some(rest) = trimmed.strip_prefix(prefix) {
                if let Some(body) = rest.strip_suffix(';') {
                    let inner = body
                        .trim()
                        .trim_matches(|c: char| c == '"' || c == '\'' || c == '(' || c == ')')
                        .trim();
                    if !inner.is_empty() {
                        imports.push(if inner.starts_with('.') {
                            inner.to_string()
                        } else {
                            format!("./{}", inner)
                        });
                    }
                    consumed = true;
                    break;
                }
            }
        }
        if consumed {
            continue;
        }

        let words: Vec<&str> = trimmed.split_whitespace().collect();
        for (i, w) in words.iter().enumerate() {
            let kind = match *w {
                "class" => Some("class"),
                "interface" => Some("interface"),
                "trait" => Some("trait"),
                "function" => Some("function"),
                _ => None,
            };
            if let Some(k) = kind {
                if let Some(next) = words.get(i + 1) {
                    push_symbol(&mut symbols, take_ident(next), k, line_num);
                }
            }
        }
    }

    AstAnalysis { symbols, imports }
}

fn analyze_csharp(content: &str) -> AstAnalysis {
    let mut symbols = Vec::new();
    let mut imports = Vec::new();

    for (idx, line) in content.lines().enumerate() {
        let line_num = (idx + 1) as u32;
        let trimmed = line.trim();

        // using System;       (namespace — best-effort suffix match later)
        // using static Foo.Bar;
        // using Alias = Foo.Bar;
        if let Some(rest) = trimmed.strip_prefix("using ") {
            if let Some(body) = rest.strip_suffix(';') {
                let mut imp = body.trim();
                if let Some(s) = imp.strip_prefix("static ") {
                    imp = s.trim();
                }
                if let Some(pos) = imp.find('=') {
                    imp = imp[pos + 1..].trim();
                }
                if !imp.is_empty() {
                    imports.push(imp.to_string());
                }
                continue;
            }
        }

        let words: Vec<&str> = trimmed.split_whitespace().collect();
        for (i, w) in words.iter().enumerate() {
            let kind = match *w {
                "class" => Some("class"),
                "interface" => Some("interface"),
                "struct" => Some("struct"),
                "enum" => Some("enum"),
                "record" => Some("record"),
                _ => None,
            };
            if let Some(k) = kind {
                if let Some(next) = words.get(i + 1) {
                    push_symbol(&mut symbols, take_ident(next), k, line_num);
                }
            }
        }
    }

    AstAnalysis { symbols, imports }
}

fn analyze_swift(content: &str) -> AstAnalysis {
    let mut symbols = Vec::new();
    let mut imports = Vec::new();

    for (idx, line) in content.lines().enumerate() {
        let line_num = (idx + 1) as u32;
        let trimmed = line.trim();

        // import Foundation
        // import struct MyModule.MyStruct
        if let Some(rest) = trimmed.strip_prefix("import ") {
            let rest = rest.trim();
            // optional submodule kind: struct/class/func/protocol/enum/typealias/var/let
            let stripped = ["struct ", "class ", "func ", "protocol ", "enum ", "typealias ", "var ", "let "]
                .iter()
                .find_map(|p| rest.strip_prefix(p))
                .unwrap_or(rest);
            let imp = stripped.trim();
            if !imp.is_empty() {
                imports.push(imp.to_string());
            }
            continue;
        }

        let words: Vec<&str> = trimmed.split_whitespace().collect();
        for (i, w) in words.iter().enumerate() {
            let kind = match *w {
                "class" => Some("class"),
                "struct" => Some("struct"),
                "protocol" => Some("protocol"),
                "enum" => Some("enum"),
                "func" => Some("function"),
                _ => None,
            };
            if let Some(k) = kind {
                if let Some(next) = words.get(i + 1) {
                    push_symbol(&mut symbols, take_ident(next), k, line_num);
                }
            }
        }
    }

    AstAnalysis { symbols, imports }
}
