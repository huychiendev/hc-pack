const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const ignore = require('ignore');

function activate(context) {
  const disposable = vscode.commands.registerCommand('hcpack.pack', async (uri) => {
    if (!uri?.fsPath) return vscode.window.showErrorMessage('Right-click vào thư mục/file');
    if (!vscode.workspace.workspaceFolders?.[0]) return vscode.window.showErrorMessage('Mở workspace trước');

    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: "📦 Đang pack...",
      cancellable: false
    }, async () => {
      try {
        let targetDir = uri.fsPath;
        if (fs.existsSync(targetDir) && fs.statSync(targetDir).isFile()) {
          targetDir = path.dirname(targetDir);
        }
        
        const projectRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
        const folderName = path.basename(targetDir);
        const outputFile = path.join(projectRoot, `${folderName}.xml`);
        const extensions = [
          '.ts', '.tsx', '.js', '.jsx', '.cs', '.vb', '.mjs', '.md', '.rs', 
          '.toml', '.sql', '.yml', '.yaml', '.json', '.css', '.html', 
          '.cshtml', '.csproj', '.razor', '.sln', '.config', '.props', '.targets'
        ];

        const ig = ignore().add(fs.existsSync(path.join(projectRoot, '.gitignore')) ? fs.readFileSync(path.join(projectRoot, '.gitignore'), 'utf8') : '');

        const files = new Set();
        const tokenMap = new Map();

        function normalize(p) {
          if (!p) return '';
          let rel = path.relative(projectRoot, p).replace(/\\/g, '/');
          if (rel.startsWith('./')) rel = rel.slice(2);
          if (rel.startsWith('..') || rel.startsWith('/')) return path.basename(p).replace(/\\/g, '/');
          return rel || '.';
        }

        function shouldIgnore(filePath) {
          const rel = normalize(filePath);
          if (!rel || rel === '.' || rel.startsWith('..') || rel.startsWith('/')) {
            return rel.includes('node_modules') || rel.includes('.git') || rel.includes('target/');
          }
          try {
            return ig.ignores(rel) || rel.includes('node_modules') || rel.includes('.git') || rel.includes('target/');
          } catch {
            return false;
          }
        }

        function countTokens(content) { return Math.ceil(content.length / 4); }

        function scanFile(filePath) {
          if (files.has(filePath) || shouldIgnore(filePath)) return;
          files.add(filePath);
          const content = fs.readFileSync(filePath, 'utf8');
          tokenMap.set(filePath, countTokens(content));

          const importRegex = /(?:import|require)\s*(?:type\s+)?(?:[\w\s{},*]+from)?\s*['"](.+?)['"]/g;
          let m;
          while ((m = importRegex.exec(content)) !== null) {
            let imp = m[1].trim();
            if (imp.startsWith('.')) {
              const abs = path.resolve(path.dirname(filePath), imp);
              extensions.forEach(ext => { if (fs.existsSync(abs + ext)) scanFile(abs + ext); });
              if (fs.existsSync(abs + '/index.ts')) scanFile(abs + '/index.ts');
              if (fs.existsSync(abs + '/index.tsx')) scanFile(abs + '/index.tsx');
            } else if (imp.startsWith('@/')) {
              const abs = path.resolve(projectRoot, 'src', imp.slice(2));
              extensions.forEach(ext => { if (fs.existsSync(abs + ext)) scanFile(abs + ext); });
            }
          }
        }

        function walkDir(dir) {
          if (!fs.existsSync(dir) || shouldIgnore(dir)) return;
          const stat = fs.statSync(dir);
          if (stat.isDirectory()) {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
              const full = path.join(dir, entry.name);
              if (entry.isDirectory()) walkDir(full);
              else if (extensions.some(ext => full.endsWith(ext))) scanFile(full);
            }
          } else if (extensions.some(ext => dir.endsWith(ext))) {
            scanFile(dir);
          }
        }

        walkDir(targetDir);

        const manual = ['src/components/DynamicTable', 'src/libs/protable-excel', 'src/hooks', 'src/utils/irp.utils.ts', 'src/pages/IRPE/shared', 'docs'];
        manual.forEach(p => {
          const abs = path.resolve(projectRoot, p);
          if (!fs.existsSync(abs)) return;
          if (fs.statSync(abs).isDirectory()) walkDir(abs); else scanFile(abs);
        });

        const docsDir = path.resolve(projectRoot, 'docs');
        if (fs.existsSync(docsDir)) {
          fs.readdirSync(docsDir).forEach(file => {
            if (file.match(/^IRP.*\.md$/i)) scanFile(path.join(docsDir, file));
          });
        }

        if (files.size === 0) {
          return vscode.window.showWarningMessage(`⚠️ Không tìm thấy file nào trong ${folderName}`);
        }

        let totalTokens = 0;
        tokenMap.forEach(t => totalTokens += t);

        let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<repomix>\n<file_summary>\nTổng file: ${files.size}\nTổng token: ${totalTokens}\n</file_summary>\n<directory_structure>\n`;
        files.forEach(f => xml += `  ${normalize(f)}\n`);
        xml += `</directory_structure>\n<files>\n`;
        files.forEach(filePath => {
          const rel = normalize(filePath);
          const content = fs.readFileSync(filePath, 'utf8');
          xml += `  <file path="${rel}" tokens="${tokenMap.get(filePath)}">\n${content}\n  </file>\n`;
        });
        xml += `</files>\n</repomix>`;

        fs.writeFileSync(outputFile, xml);

        const outputUri = vscode.Uri.file(outputFile);
        vscode.window.showTextDocument(outputUri);
        // vscode.commands.executeCommand('revealFileInOS', outputUri);

        vscode.window.showInformationMessage(`✅ Xong → ${path.basename(outputFile)} (${files.size} file, ${totalTokens.toLocaleString()} tokens)`);
      } catch (err) {
        vscode.window.showErrorMessage('❌ Lỗi: ' + err.message);
      }
    });
  });

  context.subscriptions.push(disposable);
}

module.exports = { activate };