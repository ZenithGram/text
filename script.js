/* --- CONFIGURATION --- */
// ЖЕСТКИЕ игноры - только то, что намертво "повесит" браузер (в DOM не попадает вообще)
const HARD_IGNORED = ['.git', 'node_modules'];

// МЯГКИЕ игноры - попадают в интерфейс в раздел "Скрытые" (серые, галочка снята)
const IGNORED_FOLDERS = [
    '.idea', '.vscode', '.github', '.gitlab', 'vendor', 'bower_components',
    'dist', 'build', 'out', 'target', 'bin', 'obj', 'coverage', '__pycache__',
    '.next', '.nuxt', '.cache', 'venv', 'env', '.mypy_cache', '.ds_store', '.sass-cache'
];
const IGNORED_FILES = [
    'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'composer.lock', 'Cargo.lock', '.DS_Store', 'thumbs.db'
];
const ALLOWED_EXTENSIONS = [
    '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.vue', '.svelte',
    '.html', '.htm', '.css', '.scss', '.sass', '.less',
    '.php', '.py', '.rb', '.pl', '.pm', '.go', '.rs', '.dart', '.lua',
    '.java', '.kt', '.kts', '.swift', '.c', '.cpp', '.h', '.hpp', '.cs', '.sh', '.bat', '.cmd', '.ps1',
    '.json', '.yaml', '.yml', '.toml', '.xml', '.sql', '.graphql', '.env.example', '.dockerfile', 'dockerfile',
    '.md', '.mdx', '.txt', '.rst', '.conf', '.cfg'
];

/* --- GLOBAL STATE --- */
let allPaths = [];
let treeDataRoot = {};
let globalFileList = null;
let isZipMode = false;
let githubRepoMeta = null;
let statsCache = {};
let currentZipName = "";
// Для умного восстановления выбора
let lastLoadedPaths = new Set();
let lastSelectedPaths = new Set();

/* --- THEME TOGGLE --- */
document.addEventListener('DOMContentLoaded', () => {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    if (savedTheme === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
        updateThemeIcon(true);
    } else {
        document.documentElement.setAttribute('data-theme', 'dark');
        updateThemeIcon(false);
    }
});
function toggleTheme() {
    const html = document.documentElement;
    if (html.getAttribute('data-theme') === 'light') {
        html.setAttribute('data-theme', 'dark');
        localStorage.setItem('theme', 'dark');
        updateThemeIcon(false);
    } else {
        html.setAttribute('data-theme', 'light');
        localStorage.setItem('theme', 'light');
        updateThemeIcon(true);
    }
}
function updateThemeIcon(isLight) {
    const btn = document.getElementById('theme-toggle');
    btn.innerHTML = isLight ? '<i class="fa-solid fa-moon"></i>' : '<i class="fa-solid fa-sun"></i>';
}

/* --- TABS --- */
function switchTab(tab) {
    lastLoadedPaths.clear();
    lastSelectedPaths.clear();

    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    if (tab === 'github') {
        document.querySelector('button[onclick="switchTab(\'github\')"]').classList.add('active');
        document.getElementById('github-panel').classList.add('active');
    } else {
        document.querySelector('button[onclick="switchTab(\'local\')"]').classList.add('active');
        document.getElementById('local-panel').classList.add('active');
    }
}

/* --- HELPERS --- */
function isHardIgnored(path) {
    const parts = path.split('/');
    return parts.some(p => HARD_IGNORED.includes(p));
}

// Проверяет, должен ли файл быть "скрытым" (серым) в интерфейсе
function checkIfHidden(name, fullPath, isFolder) {
    const parts = fullPath.split('/');
    // 1. Папки
    for (const part of parts) {
        if (IGNORED_FOLDERS.includes(part)) return true;
    }
    // 2. Файлы
    if (!isFolder) {
        if (IGNORED_FILES.includes(name)) return true;

        const lastDotIndex = name.lastIndexOf('.');

        // Файлы без расширения (например, hosts, Makefile) больше НЕ скрываем!
        if (lastDotIndex === -1) {
            return false;
        }

        const lowerName = name.toLowerCase();
        const ext = lowerName.substring(lastDotIndex);

        // Оставляем системные конфиги (.env, .gitignore) и файлы, чьё полное имя есть в списке (dockerfile, .env.example)
        if (ALLOWED_EXTENSIONS.includes(lowerName) || lowerName === '.gitignore' || lowerName === '.env') {
            return false;
        }

        // Скрываем, если расширение не входит в список разрешенных
        if (!ALLOWED_EXTENSIONS.includes(ext)) {
            return true;
        }
    }
    return false;
}

/* --- LOAD DATA --- */
async function fetchGitHubRepo() {
    saveCurrentSelection();
    const urlInput = document.getElementById('repoUrl').value.trim();
    let token = document.getElementById('repoToken').value.trim();
    if (!urlInput) return alert("Введите URL репозитория");
    if (token.toLowerCase().startsWith('bearer ')) token = token.slice(7).trim();
    const cleanUrl = urlInput.replace(/\/$/, '').replace('.git', '');
    const match = cleanUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (!match) return alert("Некорректная ссылка GitHub");
    const owner = match[1], repo = match[2];

    try {
        const headers = { 'Accept': 'application/vnd.github.v3+json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const repoRes = await fetchWithRetry(`https://api.github.com/repos/${owner}/${repo}`, headers);
        const repoData = await repoRes.json();
        githubRepoMeta = { owner, repo, branch: repoData.default_branch, token };
        globalFileList = null; isZipMode = false;

        const treeRes = await fetchWithRetry(`https://api.github.com/repos/${owner}/${repo}/git/trees/${repoData.default_branch}?recursive=1`, headers);
        const treeData = await treeRes.json();
        if (treeData.truncated) alert("Репозиторий очень большой, показаны не все файлы.");

        allPaths = treeData.tree
            .filter(item => item.type === 'blob' && !isHardIgnored(item.path))
            .map(item => item.path);

        if (allPaths.length === 0) return alert("Пусто.");
        initializeTree(allPaths);
    } catch (e) {
        alert("ОШИБКА:\n" + e.message);
    }
}

document.getElementById('folderInput').addEventListener('change', (e) => {
    const files = e.target.files;
    if (files.length === 0) return;
    saveCurrentSelection();
    allPaths = [];
    globalFileList = Array.from(files);
    githubRepoMeta = null; isZipMode = false;

    for (let i = 0; i < globalFileList.length; i++) {
        const path = globalFileList[i].webkitRelativePath;
        if (!isHardIgnored(path)) allPaths.push(path);
    }
    if (allPaths.length > 0) initializeTree(allPaths);
    e.target.value = '';
});

document.getElementById('zipInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    saveCurrentSelection();
    currentZipName = file.name.replace(/\.[^/.]+$/, "");
    try {
        const zip = new JSZip();
        const zipContent = await zip.loadAsync(file);
        allPaths = []; globalFileList = []; githubRepoMeta = null; isZipMode = true;

        zipContent.forEach((relativePath, zipEntry) => {
            if (!zipEntry.dir && !isHardIgnored(relativePath)) {
                allPaths.push(relativePath);
                globalFileList.push({ path: relativePath, zipObj: zipEntry });
            }
        });
        allPaths.sort();
        if (allPaths.length > 0) initializeTree(allPaths);
    } catch (err) {
        alert("Ошибка ZIP: " + err.message);
    }
    e.target.value = '';
});

/* --- UI INITIALIZATION --- */
function initializeTree(paths) {
    document.getElementById('file-list').innerHTML = '';
    document.getElementById('tree-output-container').innerHTML = '';
    statsCache = {};
    treeDataRoot = buildTreeObject(paths);

    const container = document.getElementById('file-list');
    const rootUl = document.createElement('ul');
    rootUl.className = 'selection-tree';

    const keys = Object.keys(treeDataRoot).sort(sortItems(treeDataRoot));
    keys.forEach(key => {
        rootUl.appendChild(createNode(key, treeDataRoot[key], '', true));
    });
    container.appendChild(rootUl);

    const allFileCheckboxes = container.querySelectorAll('input[type="checkbox"][data-type="file"]');

    if (lastLoadedPaths.size > 0) {
        allFileCheckboxes.forEach(cb => {
            const path = cb.dataset.path;
            if (lastLoadedPaths.has(path)) {
                cb.checked = lastSelectedPaths.has(path);
            }
        });
    }

    allFileCheckboxes.forEach(cb => updateAncestors(cb));

    renderExtensions(paths);
    document.getElementById('selection-section').classList.remove('hidden');
    document.getElementById('result-section').classList.add('hidden');
    updateSelectionCount();
}

function buildTreeObject(paths) {
    const root = {};
    paths.forEach(path => {
        const parts = path.split('/');
        let current = root;
        parts.forEach((part, index) => {
            if (!current[part]) current[part] = (index === parts.length - 1) ? null : {};
            current = current[part];
        });
    });
    return root;
}

const sortItems = (node) => (a, b) => {
    const aIsFolder = node[a] !== null;
    const bIsFolder = node[b] !== null;
    if (aIsFolder && !bIsFolder) return -1;
    if (!aIsFolder && bIsFolder) return 1;
    return a.localeCompare(b);
};

/* --- NODE CREATION --- */
function createNode(name, data, parentPath, parentChecked) {
    const li = document.createElement('li');
    const fullPath = parentPath ? `${parentPath}/${name}` : name;
    const isFolder = data !== null;

    const isHiddenCategory = checkIfHidden(name, fullPath, isFolder);
    if (isHiddenCategory) {
        li.classList.add('is-ignored');
    }

    let isChecked = parentChecked;
    if (isHiddenCategory) {
        isChecked = false;
    }

    const div = document.createElement('div');
    div.className = 'selection-item';

    const caret = document.createElement('span');
    if (isFolder) {
        caret.className = 'caret';
        caret.onclick = (e) => {
            e.stopPropagation();
            caret.classList.toggle('caret-down');
            const childUl = li.querySelector('ul');
            if (childUl) childUl.classList.toggle('expanded');
        };
    } else {
        caret.className = 'spacer';
    }

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.dataset.path = fullPath;
    checkbox.dataset.type = isFolder ? 'folder' : 'file';
    checkbox.checked = isChecked;

    checkbox.onclick = (e) => {
        const currentState = e.target.checked;
        if (isFolder) {
            const children = li.querySelectorAll('input[type="checkbox"]');
            children.forEach(child => {
                child.checked = currentState;
                child.indeterminate = false;
            });
        }
        updateAncestors(checkbox);
        updateSelectionCount();
    };

    const label = document.createElement('span');
    label.className = `item-name ${isFolder ? 'folder-label' : 'file-label'}`;
    label.innerText = name;
    label.onclick = () => checkbox.click();

    div.appendChild(caret);
    div.appendChild(checkbox);
    div.appendChild(label);
    li.appendChild(div);

    if (isFolder) {
        const ul = document.createElement('ul');
        const keys = Object.keys(data).sort(sortItems(data));
        keys.forEach(key => {
            ul.appendChild(createNode(key, data[key], fullPath, isChecked));
        });
        li.appendChild(ul);
    }
    return li;
}

function updateAncestors(el) {
    const parentUl = el.closest('ul');
    if (!parentUl || parentUl.classList.contains('selection-tree')) return;
    const parentLi = parentUl.parentElement;
    const parentCheckbox = parentLi.querySelector(':scope > .selection-item > input[type="checkbox"]');
    if (!parentCheckbox) return;

    const siblings = Array.from(parentUl.children).map(li =>
        li.querySelector(':scope > .selection-item > input[type="checkbox"]')
    );
    const allChecked = siblings.every(cb => cb.checked);
    const allUnchecked = siblings.every(cb => !cb.checked);
    const someIndeterminate = siblings.some(cb => cb.indeterminate);

    if (allChecked && !someIndeterminate) {
        parentCheckbox.checked = true;
        parentCheckbox.indeterminate = false;
    } else if (allUnchecked && !someIndeterminate) {
        parentCheckbox.checked = false;
        parentCheckbox.indeterminate = false;
    } else {
        parentCheckbox.checked = false;
        parentCheckbox.indeterminate = true;
    }
    updateAncestors(parentCheckbox);
}

function updateSelectionCount() {
    const count = document.querySelectorAll('input[type="checkbox"][data-type="file"]:checked').length;
    document.getElementById('file-counter').innerText = count;
}

/* --- TOGGLES & ACTIONS --- */
function toggleIgnoredView() {
    document.getElementById('file-list').classList.toggle('show-ignored');
}

function toggleAll(state) {
    const isShowingIgnored = document.getElementById('file-list').classList.contains('show-ignored');

    document.querySelectorAll('#file-list input[type="checkbox"]').forEach(cb => {
        if (!isShowingIgnored && cb.closest('.is-ignored')) return;
        cb.checked = state;
        cb.indeterminate = false;
    });

    const allFileCheckboxes = document.querySelectorAll('input[type="checkbox"][data-type="file"]');
    allFileCheckboxes.forEach(cb => updateAncestors(cb));
    updateSelectionCount();
}

function renderExtensions(paths) {
    const container = document.getElementById('extension-list');
    container.innerHTML = '';
    const counts = {};
    paths.forEach(p => {
        const name = p.split('/').pop();
        if (name.includes('.')) {
            const ext = '.' + name.split('.').pop();
            counts[ext] = (counts[ext] || 0) + 1;
        } else {
            counts['no-ext'] = (counts['no-ext'] || 0) + 1;
        }
    });
    if (Object.keys(counts).length === 0) {
        document.getElementById('extension-container').classList.add('hidden');
        return;
    }
    document.getElementById('extension-container').classList.remove('hidden');
    Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([ext, count]) => {
        const tag = document.createElement('div');
        tag.className = 'ext-tag';
        tag.innerHTML = `${ext} <span class="ext-count">${count}</span>`;
        tag.onclick = () => toggleByExtension(ext);
        container.appendChild(tag);
    });
}

function toggleByExtension(ext) {
    const allFileCheckboxes = Array.from(document.querySelectorAll('input[type="checkbox"][data-type="file"]'));
    const targets = allFileCheckboxes.filter(cb => {
        const path = cb.dataset.path;
        if (ext === 'no-ext') return !path.split('/').pop().includes('.');
        return path.endsWith(ext);
    });
    if (targets.length === 0) return;
    const isAllSelected = targets.every(cb => cb.checked);
    const newState = !isAllSelected;
    targets.forEach(cb => {
        cb.checked = newState;
        updateAncestors(cb);
    });
    updateSelectionCount();
}

/* --- SAVE SELECTION (MEMORY) --- */
function saveCurrentSelection() {
    const fileBoxes = document.querySelectorAll('input[type="checkbox"][data-type="file"]');
    if (fileBoxes.length > 0) {
        lastLoadedPaths = new Set(Array.from(fileBoxes).map(cb => cb.dataset.path));
        lastSelectedPaths = new Set(Array.from(fileBoxes).filter(cb => cb.checked).map(cb => cb.dataset.path));
    }
}

/* --- GENERATE VIEW --- */
let finalResultObject = {};
function generateTree() {
    const checkedFiles = Array.from(document.querySelectorAll('input[type="checkbox"][data-type="file"]:checked'))
        .map(cb => cb.dataset.path);
    if (checkedFiles.length === 0) return alert("Ничего не выбрано!");
    finalResultObject = buildTreeObject(checkedFiles);
    renderCurrentView();
    document.getElementById('result-section').classList.remove('hidden');
    if (!document.getElementById('result-section').classList.contains('visible-once')) {
        setTimeout(() => document.getElementById('result-section').scrollIntoView({ behavior: 'smooth' }), 100);
        document.getElementById('result-section').classList.add('visible-once');
    }
}

function renderCurrentView() {
    const mode = document.getElementById('view-mode').value;
    const container = document.getElementById('tree-output-container');
    container.innerHTML = '';
    if (mode === 'vertical') {
        container.innerHTML = `<div class="vertical-tree">${renderVerticalRecursive(finalResultObject, '', true)}</div>`;
    } else {
        const pre = document.createElement('pre');
        pre.className = 'ascii-tree';
        pre.textContent = renderASCIIRecursive(finalResultObject);
        container.appendChild(pre);
    }
}

function renderVerticalRecursive(node, currentPath, isRoot) {
    if (!node) return '';
    let html = '<ul>';
    const keys = Object.keys(node).sort(sortItems(node));
    keys.forEach(key => {
        const isFolder = node[key] !== null;
        const fullPath = currentPath ? `${currentPath}/${key}` : key;
        const icon = isFolder ? '<i class="fa-solid fa-folder"></i>' : '<i class="fa-regular fa-file"></i>';
        let statHtml = '';
        let stats = { lines: 0, code: 0 };
        if (!isFolder && statsCache[fullPath]) stats = statsCache[fullPath];
        else if (isFolder) stats = calculateFolderStats(node[key], fullPath);

        if (stats.lines > 0) {
            statHtml = `<span class="line-badge" title="Всего строк / Чистый код">${stats.lines} / ${stats.code}</span>`;
        }
        html += `<li><div class="tree-row">${icon} <span>${key}</span> ${statHtml}</div>${isFolder ? renderVerticalRecursive(node[key], fullPath, false) : ''}</li>`;
    });
    return html + '</ul>';
}

function calculateFolderStats(node, currentPath) {
    let sum = { lines: 0, code: 0 };
    if (!node) return sum;
    Object.keys(node).forEach(key => {
        const fullPath = currentPath ? `${currentPath}/${key}` : key;
        if (node[key] === null) {
            if (statsCache[fullPath]) {
                sum.lines += (statsCache[fullPath].lines || 0);
                sum.code += (statsCache[fullPath].code || 0);
            }
        } else {
            const childStats = calculateFolderStats(node[key], fullPath);
            sum.lines += childStats.lines;
            sum.code += childStats.code;
        }
    });
    return sum;
}

function renderASCIIRecursive(node, prefix = "") {
    let result = "";
    const keys = Object.keys(node).sort(sortItems(node));
    keys.forEach((key, index) => {
        const isLast = index === keys.length - 1;
        const connector = isLast ? "└── " : "├── ";
        result += prefix + connector + key + "\n";
        if (node[key] !== null) {
            result += renderASCIIRecursive(node[key], prefix + (isLast ? "    " : "│   "));
        }
    });
    return result;
}

function copyToClipboard() {
    navigator.clipboard.writeText(document.getElementById('tree-output-container').innerText).then(() => alert("Скопировано!"));
}

/* --- PROCESS FILES --- */
async function processFiles(mode) {
    const checkedFiles = Array.from(document.querySelectorAll('input[type="checkbox"][data-type="file"]:checked')).map(cb => cb.dataset.path);
    if (checkedFiles.length === 0) return alert("Ничего не выбрано!");
    if (githubRepoMeta && checkedFiles.length > 50 && mode === 'download') {
        if (!confirm(`Выбрано ${checkedFiles.length} файлов. Скачивание может занять время. Продолжить?`)) return;
    }
    const statusDiv = document.getElementById('loading-status');
    const statusText = document.getElementById('loading-text');
    statusDiv.classList.remove('hidden');
    let totalLinesCount = 0, codeLinesCount = 0, outputContent = "";

    if (mode === 'download') {
        outputContent += "PROJECT DIRECTORY STRUCTURE:\n" + renderASCIIRecursive(buildTreeObject(checkedFiles)) + "\n\n";
    }

    try {
        for (let i = 0; i < checkedFiles.length; i++) {
            const path = checkedFiles[i];
            statusText.innerText = `${mode === 'download' ? "Скачивание" : "Анализ"}: ${i + 1}/${checkedFiles.length}`;
            let content = "", fetchSuccess = false;

            if (githubRepoMeta) {
                try {
                    const res = await fetchWithRetry(`https://api.github.com/repos/${githubRepoMeta.owner}/${githubRepoMeta.repo}/contents/${path}?ref=${githubRepoMeta.branch}`,
                        { 'Accept': 'application/vnd.github.v3+json', ...(githubRepoMeta.token && {'Authorization': `Bearer ${githubRepoMeta.token}`}) });
                    const data = await res.json();
                    content = data.encoding === 'base64' ? new TextDecoder().decode(Uint8Array.from(atob(data.content), c => c.charCodeAt(0))) : atob(data.content);
                    fetchSuccess = true;
                } catch (e) { console.error(e); }
            } else if (isZipMode) {
                const fileEntry = globalFileList.find(f => f.path === path);
                if (fileEntry) { content = await fileEntry.zipObj.async("string"); fetchSuccess = true; }
            } else {
                const fileObj = globalFileList.find(f => f.webkitRelativePath === path);
                if (fileObj) { content = await fileObj.text(); fetchSuccess = true; }
            }

            if (fetchSuccess) {
                const lines = content.split('\n');
                const fileTotal = lines.length;
                const fileCode = lines.filter(line => line.trim() !== '').length;
                totalLinesCount += fileTotal; codeLinesCount += fileCode;
                statsCache[path] = { lines: fileTotal, code: fileCode };

                if (mode === 'download') {
                    const ext = path.includes('.') ? '.' + path.split('.').pop().toLowerCase() : '';
                    outputContent += "===\nFile: " + path + "\n===\n" +
                        optimizeCode(content, ext, document.getElementById('opt-remove-comments').checked, document.getElementById('opt-remove-empty').checked) + "\n\n";
                }
            } else {
                statsCache[path] = { lines: 0, code: 0 };
            }
        }

        document.getElementById('stat-total-lines').innerText = totalLinesCount.toLocaleString();
        document.getElementById('stat-code-lines').innerText = codeLinesCount.toLocaleString();

        if (mode === 'stats') generateTree();
        if (mode === 'download') {
            let filename = "project_bundle.txt";
            if (githubRepoMeta) filename = `${githubRepoMeta.repo}.txt`;
            else if (isZipMode && currentZipName) filename = `${currentZipName}.txt`;
            else if (globalFileList && globalFileList.length > 0) filename = `${globalFileList[0].webkitRelativePath.split('/')[0]}.txt`;
            downloadAsFile(filename, outputContent);
        }
        statusText.innerText = "Готово!";
        setTimeout(() => statusDiv.classList.add('hidden'), 1000);
    } catch (e) {
        alert("Ошибка: " + e.message); statusDiv.classList.add('hidden');
    }
}

async function fetchWithRetry(url, headers, retries = 3, delay = 1000) {
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetch(url, { headers });
            if (!res.ok) throw new Error(`Status ${res.status}`);
            return res;
        } catch (err) {
            if (i === retries - 1) throw err;
            await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
        }
    }
}

function downloadAsFile(filename, text) {
    const element = document.createElement('a');
    element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(text));
    element.setAttribute('download', filename);
    element.style.display = 'none';
    document.body.appendChild(element); element.click(); document.body.removeChild(element);
}

function optimizeCode(content, ext, removeComments, removeEmpty) {
    let result = content;
    if (removeComments) {
        if (['.js', '.ts', '.jsx', '.tsx', '.css', '.scss', '.java', '.c', '.cpp', '.cs', '.php'].includes(ext)) {
            result = result.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^(\s*)\/\/.*$/gm, '$1');
        } else if (['.py', '.rb', '.sh', '.yaml', '.yml', '.dockerfile'].includes(ext)) {
            result = result.replace(/^(\s*)#.*$/gm, '$1');
        } else if (['.html', '.xml', '.svg'].includes(ext)) {
            result = result.replace(/<!--[\s\S]*?-->/g, '');
        }
    }
    if (removeEmpty) result = result.split('\n').filter(line => line.trim() !== '').join('\n');
    return result.trim();
}