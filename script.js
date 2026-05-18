/* --- CONFIGURATION --- */
const HARD_IGNORED = ['.git', 'node_modules'];
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
    return path.split('/').some(p => HARD_IGNORED.includes(p));
}

function checkIfHidden(name, fullPath, isFolder) {
    const parts = fullPath.split('/');
    for (const part of parts) {
        if (IGNORED_FOLDERS.includes(part)) return true;
    }
    if (!isFolder) {
        if (IGNORED_FILES.includes(name)) return true;
        const lastDotIndex = name.lastIndexOf('.');
        if (lastDotIndex === -1) return false;
        const lowerName = name.toLowerCase();
        const ext = lowerName.substring(lastDotIndex);
        if (ALLOWED_EXTENSIONS.includes(lowerName) || lowerName === '.gitignore' || lowerName === '.env') return false;
        if (!ALLOWED_EXTENSIONS.includes(ext)) return true;
    }
    return false;
}

/* --- LOAD DATA --- */
async function fetchGitHubRepo() {
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

        allPaths = treeData.tree.filter(item => item.type === 'blob' && !isHardIgnored(item.path)).map(item => item.path);
        if (allPaths.length === 0) return alert("Пусто.");
        initializeTree(allPaths);
    } catch (e) {
        alert("ОШИБКА:\n" + e.message);
    }
}

document.getElementById('folderInput').addEventListener('change', (e) => {
    const files = e.target.files;
    if (files.length === 0) return;
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

    // Восстановление из LocalStorage
    const allFileCheckboxes = container.querySelectorAll('input[type="checkbox"][data-type="file"]');
    const savedPaths = JSON.parse(localStorage.getItem('fileTree_selectedPaths') || "null");
    const savedAllPaths = JSON.parse(localStorage.getItem('fileTree_allPaths') || "[]");

    const currentAllPaths = Array.from(allFileCheckboxes).map(cb => cb.dataset.path);
    const savedAllSet = new Set(savedAllPaths);

    // Эвристика: если открываемая директория имеет пересечения с прошлой - восстанавливаем.
    const isSameProject = currentAllPaths.some(p => savedAllSet.has(p));

    if (savedPaths !== null && isSameProject) {
        const savedSet = new Set(savedPaths);
        allFileCheckboxes.forEach(cb => {
            cb.checked = savedSet.has(cb.dataset.path);
        });
    }

    allFileCheckboxes.forEach(cb => updateAncestors(cb));

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

    if (isHiddenCategory) li.classList.add('is-ignored');

    let isChecked = parentChecked;
    if (isHiddenCategory) isChecked = false;

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
    const fileBoxes = document.querySelectorAll('input[type="checkbox"][data-type="file"]');
    const checkedBoxes = Array.from(fileBoxes).filter(cb => cb.checked);

    document.getElementById('file-counter').innerText = checkedBoxes.length;

    updateExtensionsUI();

    // Сохранение в LocalStorage (Защита от потери при F5)
    const checkedPaths = checkedBoxes.map(cb => cb.dataset.path);
    const allPathsList = Array.from(fileBoxes).map(cb => cb.dataset.path);
    localStorage.setItem('fileTree_selectedPaths', JSON.stringify(checkedPaths));
    localStorage.setItem('fileTree_allPaths', JSON.stringify(allPathsList));
}

/* --- TOGGLES & ACTIONS --- */
function toggleIgnoredView() {
    document.getElementById('file-list').classList.toggle('show-ignored');
    updateExtensionsUI(); // Перерисовываем теги в зависимости от видимости скрытых
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

function updateExtensionsUI() {
    const isShowingIgnored = document.getElementById('file-list').classList.contains('show-ignored');
    const allFileCheckboxes = document.querySelectorAll('input[type="checkbox"][data-type="file"]');
    const counts = {};

    allFileCheckboxes.forEach(cb => {
        // Пропускаем те, что скрыты и не отображаются
        if (!isShowingIgnored && cb.closest('.is-ignored')) return;

        const path = cb.dataset.path;
        const isChecked = cb.checked;
        const name = path.split('/').pop();

        let ext = 'no-ext';
        if (name.includes('.')) {
            ext = '.' + name.split('.').pop();
        }

        if (!counts[ext]) counts[ext] = { total: 0, checked: 0 };
        counts[ext].total++;
        if (isChecked) counts[ext].checked++;
    });

    const container = document.getElementById('extension-list');
    container.innerHTML = '';

    const activeExtensions = Object.keys(counts);
    if (activeExtensions.length === 0) {
        document.getElementById('extension-container').classList.add('hidden');
        return;
    }

    document.getElementById('extension-container').classList.remove('hidden');

    activeExtensions.sort((a, b) => counts[b].total - counts[a].total).forEach(ext => {
        const data = counts[ext];
        const tag = document.createElement('div');
        tag.className = 'ext-tag';

        if (data.checked === 0) tag.classList.add('ext-none');
        else if (data.checked === data.total) tag.classList.add('ext-all');
        else tag.classList.add('ext-partial');

        tag.innerHTML = `${ext} <span class="ext-count">${data.checked}/${data.total}</span>`;
        tag.onclick = () => toggleByExtension(ext);
        container.appendChild(tag);
    });
}

function toggleByExtension(ext) {
    const isShowingIgnored = document.getElementById('file-list').classList.contains('show-ignored');
    const allFileCheckboxes = Array.from(document.querySelectorAll('input[type="checkbox"][data-type="file"]'));

    const targets = allFileCheckboxes.filter(cb => {
        if (!isShowingIgnored && cb.closest('.is-ignored')) return false;
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
        let stats = { chars: 0, code: 0 };

        if (!isFolder && statsCache[fullPath]) stats = statsCache[fullPath];
        else if (isFolder) stats = calculateFolderStats(node[key], fullPath);

        if (stats.chars > 0) {
            statHtml = `<span class="line-badge" title="Символов / Строк кода">${stats.chars} / ${stats.code}</span>`;
        }

        html += `<li><div class="tree-row">${icon} <span>${key}</span> ${statHtml}</div>${isFolder ? renderVerticalRecursive(node[key], fullPath, false) : ''}</li>`;
    });
    return html + '</ul>';
}

function calculateFolderStats(node, currentPath) {
    let sum = { chars: 0, code: 0 };
    if (!node) return sum;

    Object.keys(node).forEach(key => {
        const fullPath = currentPath ? `${currentPath}/${key}` : key;
        if (node[key] === null) {
            if (statsCache[fullPath]) {
                sum.chars += (statsCache[fullPath].chars || 0);
                sum.code += (statsCache[fullPath].code || 0);
            }
        } else {
            const childStats = calculateFolderStats(node[key], fullPath);
            sum.chars += childStats.chars;
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

    let totalCharsCount = 0, codeLinesCount = 0, outputContent = "";

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
                const fileChars = content.length;
                const fileCode = lines.filter(line => line.trim() !== '').length;

                totalCharsCount += fileChars;
                codeLinesCount += fileCode;
                statsCache[path] = { chars: fileChars, code: fileCode };

                if (mode === 'download') {
                    const ext = path.includes('.') ? '.' + path.split('.').pop().toLowerCase() : '';
                    outputContent += "===\nFile: " + path + "\n===\n" +
                        optimizeCode(content, ext, document.getElementById('opt-remove-comments').checked, document.getElementById('opt-remove-empty').checked) + "\n\n";
                }
            } else {
                statsCache[path] = { chars: 0, code: 0 };
            }
        }

        document.getElementById('stat-total-chars').innerText = totalCharsCount.toLocaleString();
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