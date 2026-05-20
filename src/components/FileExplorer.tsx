import { useState, useMemo } from "react";
import { Folder, FolderOpen, File, Search, ChevronRight, ChevronDown } from "lucide-react";

interface FileExplorerProps {
  files: Array<[number, string]>;
  activeFile: string | null;
  onSelectFile: (path: string) => void;
}

interface TreeNode {
  name: string;
  path: string; // Empty for folders
  isFolder: boolean;
  children: TreeNode[];
}

export function FileExplorer({ files, activeFile, onSelectFile }: FileExplorerProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({
    root: true,
  });

  // Toggle folder expansion
  const toggleFolder = (folderKey: string) => {
    setExpandedFolders((prev) => ({
      ...prev,
      [folderKey]: !prev[folderKey],
    }));
  };

  // Build the hierarchical tree from the files list
  const fileTree = useMemo(() => {
    const root: TreeNode = { name: "Root", path: "", isFolder: true, children: [] };
    
    // Filter files based on search query
    const filteredFiles = files.filter(([_, path]) =>
      path.toLowerCase().includes(searchQuery.toLowerCase())
    );

    for (const [_, relPath] of filteredFiles) {
      const parts = relPath.split("/");
      let current = root;
      
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const isLast = i === parts.length - 1;
        
        let found = current.children.find((c) => c.name === part);
        if (!found) {
          found = {
            name: part,
            path: isLast ? relPath : "",
            isFolder: !isLast,
            children: [],
          };
          current.children.push(found);
        }
        current = found;
      }
    }

    // Sort folders first, then files alphabetically
    const sortNode = (node: TreeNode) => {
      node.children.sort((a, b) => {
        if (a.isFolder && !b.isFolder) return -1;
        if (!a.isFolder && b.isFolder) return 1;
        return a.name.localeCompare(b.name);
      });
      for (const child of node.children) {
        if (child.isFolder) sortNode(child);
      }
    };
    sortNode(root);
    return root;
  }, [files, searchQuery]);

  // Determine file icon and color
  const getFileIcon = (fileName: string) => {
    const ext = fileName.split(".").pop()?.toLowerCase();
    switch (ext) {
      case "rs":
        return { icon: <span className="text-[#dea584] font-bold text-[10px] w-4 text-center">🦀</span>, color: "text-[#dea584]" };
      case "tsx":
      case "ts":
        return { icon: <span className="text-[#3178c6] font-bold text-[10px] w-4 text-center">TS</span>, color: "text-[#3178c6]" };
      case "jsx":
      case "js":
        return { icon: <span className="text-[#f1e05a] font-bold text-[10px] w-4 text-center">JS</span>, color: "text-[#f1e05a]" };
      case "json":
        return { icon: <span className="text-[#ccc] font-bold text-[10px] w-4 text-center">{}</span>, color: "text-[#e8b63a]" };
      case "md":
        return { icon: <span className="text-[#6c6a64] font-bold text-[10px] w-4 text-center">📖</span>, color: "text-muted-foreground" };
      case "css":
        return { icon: <span className="text-[#563d7c] font-bold text-[10px] w-4 text-center">CSS</span>, color: "text-[#563d7c]" };
      default:
        return { icon: <File className="w-4 h-4" />, color: "text-muted-foreground/80" };
    }
  };

  // Render tree node recursively
  const renderNode = (node: TreeNode, depth: number = 0, parentKey: string = "root") => {
    if (node === fileTree) {
      return (
        <div className="space-y-0.5">
          {node.children.map((child, idx) =>
            renderNode(child, depth, `${parentKey}-${idx}`)
          )}
        </div>
      );
    }

    const currentKey = `${parentKey}-${node.name}`;
    const isExpanded = !!expandedFolders[currentKey];

    if (node.isFolder) {
      return (
        <div key={currentKey} className="select-none">
          <div
            onClick={() => toggleFolder(currentKey)}
            className="flex items-center py-1 px-2 rounded-md hover:bg-accent/40 text-sm text-foreground/85 cursor-pointer transition-colors duration-150"
            style={{ paddingLeft: `${depth * 10 + 8}px` }}
          >
            <span className="mr-1 text-muted-foreground/60">
              {isExpanded ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
            </span>
            <span className="mr-2 text-primary/80">
              {isExpanded ? (
                <FolderOpen className="w-4 h-4" />
              ) : (
                <Folder className="w-4 h-4" />
              )}
            </span>
            <span className="truncate font-medium text-xs">{node.name}</span>
          </div>
          {isExpanded && (
            <div className="overflow-hidden">
              {node.children.map((child, idx) =>
                renderNode(child, depth + 1, `${currentKey}-${idx}`)
              )}
            </div>
          )}
        </div>
      );
    }

    // File node
    const isActive = activeFile === node.path;
    const { icon, color } = getFileIcon(node.name);

    return (
      <div
        key={currentKey}
        onClick={() => onSelectFile(node.path)}
        className={`flex items-center py-1 px-2 rounded-md text-xs cursor-pointer select-none transition-all duration-150 ${
          isActive
            ? "bg-primary text-primary-foreground font-semibold shadow-sm"
            : "hover:bg-accent/40 text-foreground/80"
        }`}
        style={{ paddingLeft: `${depth * 10 + 26}px` }}
      >
        <span className={`mr-2 shrink-0 ${isActive ? "text-primary-foreground" : color}`}>
          {icon}
        </span>
        <span className="truncate">{node.name}</span>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-sidebar border-r border-border glassy-sidebar">
      {/* Search Input */}
      <div className="p-3 border-b border-border/80">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60" />
          <input
            type="text"
            placeholder="Search files..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-secondary/80 border border-border rounded-lg pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/80 transition-colors"
          />
        </div>
      </div>

      {/* Directory Tree */}
      <div className="flex-1 overflow-y-auto p-2 scrollbar-thin">
        {fileTree.children.length > 0 ? (
          renderNode(fileTree)
        ) : (
          <div className="text-center text-muted-foreground/60 py-8 text-xs">
            No files found
          </div>
        )}
      </div>
    </div>
  );
}
