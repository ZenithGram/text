/* --- CONFIGURATION --- */
const IGNORED_FOLDERS = [
    '.git', '.idea', '.vscode', '.github', '.gitlab',
    'node_modules', 'vendor', 'bower_components',
    'dist', 'build', 'out', 'target', 'bin', 'obj',
    'coverage', '__pycache__', '.next', '.nuxt', '.cache',
    'venv', 'env', '.mypy_cache', '.ds_store', '.sass-cache'
];

const IGNORED_FILES = [
    'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
    'composer.lock', 'Cargo.lock', '.DS_Store', 'thumbs.db'
];

const ALLOWED_EXTENSIONS = [
    // Web & Scripting
    '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.vue', '.svelte',
    '.html', '.htm', '.css', '.scss', '.sass', '.less',
    '.php', '.py', '.rb', '.pl', '.pm', '.go', '.rs', '.dart', '.lua',
    // App & System
    '.java', '.kt', '.kts', '.swift', '.c', '.cpp', '.h', '.hpp', '.cs', '.sh', '.bat', '.cmd', '.ps1',
    // Data & Config
    '.json', '.yaml', '.yml', '.toml', '.xml', '.sql', '.graphql', '.env.example', '.dockerfile', 'dockerfile',
    // Docs
    '.md', '.mdx', '.txt', '.rst'
];

/* --- GLOBAL STATE --- */
let allPaths = [];
let treeDataRoot = {};
let globalFileList = null;
let isZipMode = false;
let githubRepoMeta = null;
let statsCache = {}; // { "path/to/file": { lines: 10, code: 5 } }
let currentZipName = ""; // <--- Добавьте эту строку
let lastSelectedPaths = null; // <--- ДОБАВЛЕНО: Хранилище для путей

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
    const currentTheme = html.getAttribute('data-theme');
    if (currentTheme === 'light') {
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
    lastSelectedPaths = null; // <--- Сбрасываем память при смене режима

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

/* --- HELPERS: IGNORE CHECK --- */
function isPathIgnored(path) {
    const parts = path.split('/');
    // 1. Check directories
    for (const part of parts) {
        if (IGNORED_FOLDERS.includes(part)) return true;
    }
    // 2. Check filename/extension
    const filename = parts[parts.length - 1];
    if (IGNORED_FILES.includes(filename)) return true;

    if (filename.startsWith('.') && !ALLOWED_EXTENSIONS.some(ext => filename.endsWith(ext)) && filename !== '.env.example' && filename !== '.gitignore') {
        return false;
    }
    return false;
}

/* --- LOAD DATA: GITHUB --- */
async function fetchGitHubRepo() {
    saveCurrentSelection(); // <--- ВСТАВИТЬ ЭТУ СТРОКУ В САМОЕ НАЧАЛО
    const urlInput = document.getElementById('repoUrl').value.trim();
    let token = document.getElementById('repoToken').value.trim();

    if (!urlInput) return alert("Введите URL репозитория");
    if (token.toLowerCase().startsWith('bearer ')) token = token.slice(7).trim();

    const cleanUrl = urlInput.replace(/\/$/, '').replace('.git', '');
    const match = cleanUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);

    if (!match) return alert("Некорректная ссылка GitHub. Формат: https://github.com/user/repo");

    const owner = match[1];
    const repo = match[2];

    try {
        const headers = { 'Accept': 'application/vnd.github.v3+json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const repoRes = await fetchWithRetry(`https://api.github.com/repos/${owner}/${repo}`, headers);
        const repoData = await repoRes.json();

        githubRepoMeta = { owner, repo, branch: repoData.default_branch, token };
        globalFileList = null;
        isZipMode = false;

        const treeRes = await fetchWithRetry(`https://api.github.com/repos/${owner}/${repo}/git/trees/${repoData.default_branch}?recursive=1`, headers);
        const treeData = await treeRes.json();

        if (treeData.truncated) alert("Репозиторий очень большой, показаны не все файлы.");

        allPaths = treeData.tree
            .filter(item => item.type === 'blob' && !isPathIgnored(item.path))
            .map(item => item.path);

        if (allPaths.length === 0) return alert("Репозиторий пуст или содержит только игнорируемые файлы.");

        initializeTree(allPaths);
    } catch (e) {
        alert("ОШИБКА:\n" + e.message);
        console.error(e);
    }
}

/* --- LOAD DATA: LOCAL FOLDER --- */
document.getElementById('folderInput').addEventListener('change', (e) => {
    const files = e.target.files;
    if (files.length === 0) return;

    saveCurrentSelection();

    allPaths = [];
    globalFileList = Array.from(files); // Important: Convert FileList to Array
    githubRepoMeta = null;
    isZipMode = false;

    for (let i = 0; i < globalFileList.length; i++) {
        const path = globalFileList[i].webkitRelativePath;
        if (!isPathIgnored(path)) {
            allPaths.push(path);
        }
    }

    if (allPaths.length > 0) initializeTree(allPaths);
    else alert("В выбранной папке нет допустимых файлов (или все игнорируются).");

    e.target.value = '';
});

/* --- LOAD DATA: ZIP ARCHIVE --- */
document.getElementById('zipInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    saveCurrentSelection(); // <--- ВСТАВИТЬ СЮДА

    // Сохраняем имя файла без расширения сразу при загрузке
    currentZipName = file.name.replace(/\.[^/.]+$/, "");

    try {
        const zip = new JSZip();
        const zipContent = await zip.loadAsync(file);

        allPaths = [];
        globalFileList = [];
        githubRepoMeta = null;
        isZipMode = true;

        zipContent.forEach((relativePath, zipEntry) => {
            if (!zipEntry.dir && !isPathIgnored(relativePath)) {
                allPaths.push(relativePath);
                globalFileList.push({
                    path: relativePath,
                    zipObj: zipEntry
                });
            }
        });

        allPaths.sort();

        if (allPaths.length > 0) initializeTree(allPaths);
        else alert("Архив пуст или все файлы игнорируются.");

    } catch (err) {
        alert("Ошибка при чтении ZIP файла: " + err.message);
        console.error(err);
    }

    e.target.value = '';
});
/* --- INITIALIZE UI --- */
function initializeTree(paths) {
    document.getElementById('file-list').innerHTML = '';
    document.getElementById('tree-output-container').innerHTML = '';
    document.getElementById('stat-total-lines').innerText = '0';
    document.getElementById('stat-code-lines').innerText = '0';
    statsCache = {};
    treeDataRoot = buildTreeObject(paths);

    const container = document.getElementById('file-list');
    const rootUl = document.createElement('ul');
    rootUl.className = 'selection-tree';

    const keys = Object.keys(treeDataRoot).sort(sortItems(treeDataRoot));

    // 1. Строим дерево (применяются стандартные фильтры расширений)
    keys.forEach(key => {
        rootUl.appendChild(createNode(key, treeDataRoot[key], '', true));
    });
    container.appendChild(rootUl);

    // 2. LOGIC: Restore Selection (Умное восстановление)
    if (lastSelectedPaths && lastSelectedPaths.size > 0) {
        // Находим все чекбоксы ФАЙЛОВ в новом дереве
        const allFileCheckboxes = container.querySelectorAll('input[type="checkbox"][data-type="file"]');
        let restoredCount = 0;

        allFileCheckboxes.forEach(cb => {
            const path = cb.dataset.path;
            // Если путь был в сохраненном списке -> ставим true, иначе -> false
            // Это важно: мы снимаем галочки с "дефолтных" файлов, если пользователь их не выбирал в прошлый раз
            if (lastSelectedPaths.has(path)) {
                cb.checked = true;
                restoredCount++;
            } else {
                cb.checked = false;
            }
            cb.indeterminate = false;
        });

        // 3. Обновляем визуальное состояние папок (индетерминантное состояние)
        // Проходимся снизу вверх от всех выбранных файлов
        const checkedFiles = container.querySelectorAll('input[type="checkbox"][data-type="file"]:checked');
        checkedFiles.forEach(cb => updateAncestors(cb));

        // (Опционально) Показать уведомление, если что-то восстановили
        if (restoredCount > 0) {
            console.log(`Restored selection for ${restoredCount} files.`);
            const badge = document.getElementById('file-counter');
            badge.style.backgroundColor = '#4d7c0f'; // Зеленый цвет на секунду
            setTimeout(() => badge.style.backgroundColor = '', 1000);
        }
    }

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

    let isChecked = parentChecked;

    if (parentChecked) {
        if (isFolder) {
            if (IGNORED_FOLDERS.includes(name)) isChecked = false;
        } else {
            const lastDotIndex = name.lastIndexOf('.');
            if (lastDotIndex === -1) {
                const lowerName = name.toLowerCase();
                if (['dockerfile', 'makefile', 'license', 'readme', 'changelog'].some(n => lowerName.includes(n))) {
                    isChecked = true;
                } else {
                    isChecked = false;
                }
            } else {
                const ext = name.substring(lastDotIndex).toLowerCase();
                if (!ALLOWED_EXTENSIONS.includes(ext)) isChecked = false;
            }
        }
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

/* --- FILTERS (EXTENSIONS) --- */
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

function toggleAll(state) {
    document.querySelectorAll('#file-list input[type="checkbox"]').forEach(cb => {
        cb.checked = state;
        cb.indeterminate = false;
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
        setTimeout(() => {
            document.getElementById('result-section').scrollIntoView({ behavior: 'smooth' });
        }, 100);
        document.getElementById('result-section').classList.add('visible-once');
    }
}

function renderCurrentView() {
    const mode = document.getElementById('view-mode').value;
    const container = document.getElementById('tree-output-container');
    container.innerHTML = '';

    if (mode === 'vertical') {
        container.innerHTML = `<div class="vertical-tree">${renderVerticalRecursive(finalResultObject, '', true)}</div>`;
    } else if (mode === 'ascii') {
        const pre = document.createElement('pre');
        pre.className = 'ascii-tree';
        pre.textContent = renderASCIIRecursive(finalResultObject);
        container.appendChild(pre);
    }
}

/* --- UPDATED RENDER LOGIC WITH DUAL STATS --- */
function renderVerticalRecursive(node, currentPath, isRoot) {
    if (!node) return '';
    let html = '<ul>';
    const keys = Object.keys(node).sort(sortItems(node));

    keys.forEach(key => {
        const isFolder = node[key] !== null;
        const fullPath = currentPath ? `${currentPath}/${key}` : key;
        const icon = isFolder ? '<i class="fa-solid fa-folder"></i>' : '<i class="fa-regular fa-file"></i>';

        // Stats Logic
        let statHtml = '';
        let stats = { lines: 0, code: 0 };

        if (!isFolder && statsCache[fullPath]) {
            stats = statsCache[fullPath];
        } else if (isFolder) {
            stats = calculateFolderStats(node[key], fullPath);
        }

        if (stats.lines > 0) {
            // Displays: "Total / Code"
            statHtml = `<span class="line-badge" title="Всего строк / Чистый код">${stats.lines} / ${stats.code}</span>`;
        }

        html += `<li>
            <div class="tree-row">
                ${icon} <span>${key}</span> ${statHtml}
            </div>
            ${isFolder ? renderVerticalRecursive(node[key], fullPath, false) : ''}
        </li>`;
    });

    return html + '</ul>';
}

// FIXED: Now returns object { lines, code } and sums both
function calculateFolderStats(node, currentPath) {
    let sum = { lines: 0, code: 0 };
    if (!node) return sum;

    Object.keys(node).forEach(key => {
        const fullPath = currentPath ? `${currentPath}/${key}` : key;
        if (node[key] === null) {
            // File: check cache
            if (statsCache[fullPath]) {
                sum.lines += (statsCache[fullPath].lines || 0);
                sum.code += (statsCache[fullPath].code || 0);
            }
        } else {
            // Folder: recursive
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
        const isFolder = node[key] !== null;
        const connector = isLast ? "└── " : "├── ";

        result += prefix + connector + key + "\n";

        if (isFolder) {
            const childPrefix = prefix + (isLast ? "    " : "│   ");
            result += renderASCIIRecursive(node[key], childPrefix);
        }
    });
    return result;
}

function copyToClipboard() {
    const container = document.getElementById('tree-output-container');
    navigator.clipboard.writeText(container.innerText).then(() => alert("Скопировано!"));
}

/* --- PROCESS FILES (STATS & DOWNLOAD) --- */
/* --- PROCESS FILES (STATS & DOWNLOAD) --- */
async function processFiles(mode) {
    const checkedFiles = Array.from(document.querySelectorAll('input[type="checkbox"][data-type="file"]:checked'))
        .map(cb => cb.dataset.path);

    if (checkedFiles.length === 0) return alert("Ничего не выбрано!");

    if (githubRepoMeta && checkedFiles.length > 50 && mode === 'download') {
        if (!confirm(`Выбрано ${checkedFiles.length} файлов. Скачивание может занять время. Продолжить?`)) return;
    }

    const statusDiv = document.getElementById('loading-status');
    const statusText = document.getElementById('loading-text');
    const statTotalEl = document.getElementById('stat-total-lines');
    const statCodeEl = document.getElementById('stat-code-lines');

    statusDiv.classList.remove('hidden');

    let totalLinesCount = 0;
    let codeLinesCount = 0;
    let outputContent = "";

    if (mode === 'download') {
        const treeObj = buildTreeObject(checkedFiles);
        outputContent += "PROJECT DIRECTORY STRUCTURE:\n";
        outputContent += renderASCIIRecursive(treeObj);
        outputContent += "\n\n";
    }

    try {
        for (let i = 0; i < checkedFiles.length; i++) {
            const path = checkedFiles[i];
            const actionText = mode === 'download' ? "Скачивание" : "Анализ";
            statusText.innerText = `${actionText}: ${i + 1}/${checkedFiles.length} (${path})`;

            let content = "";
            let fetchSuccess = false;

            // --- FETCH STRATEGY ---
            if (githubRepoMeta) {
                try {
                    const url = `https://api.github.com/repos/${githubRepoMeta.owner}/${githubRepoMeta.repo}/contents/${path}?ref=${githubRepoMeta.branch}`;
                    const headers = { 'Accept': 'application/vnd.github.v3+json' };
                    if (githubRepoMeta.token) headers['Authorization'] = `Bearer ${githubRepoMeta.token}`;

                    const res = await fetchWithRetry(url, headers);
                    const data = await res.json();

                    if (data.encoding === 'base64') {
                        content = new TextDecoder().decode(Uint8Array.from(atob(data.content), c => c.charCodeAt(0)));
                    } else {
                        content = atob(data.content);
                    }
                    fetchSuccess = true;
                } catch (e) {
                    console.error(`Failed ${path}: ${e.message}`);
                    if (e.message.includes('403') || e.message.includes('Rate Limit')) {
                        alert("Превышен лимит GitHub API.");
                        break;
                    }
                }
            } else if (isZipMode) {
                const fileEntry = globalFileList.find(f => f.path === path);
                if (fileEntry) {
                    try {
                        content = await fileEntry.zipObj.async("string");
                        fetchSuccess = true;
                    } catch (e) { console.error(e); }
                }
            } else if (globalFileList) {
                // Local Folder Mode
                let fileObj = null;
                for (let j = 0; j < globalFileList.length; j++) {
                    if (globalFileList[j].webkitRelativePath === path) {
                        fileObj = globalFileList[j];
                        break;
                    }
                }

                if (fileObj) {
                    try {
                        content = await fileObj.text();
                        fetchSuccess = true;
                    } catch (e) { console.error("Local read error:", e); }
                } else {
                    console.warn(`File not found: ${path}`);
                }
            }

            // --- PROCESS CONTENT ---
            if (fetchSuccess) {
                const lines = content.split('\n');
                const fileTotal = lines.length;
                const fileCode = lines.filter(line => line.trim() !== '').length;

                totalLinesCount += fileTotal;
                codeLinesCount += fileCode;

                statsCache[path] = { lines: fileTotal, code: fileCode };

                if (mode === 'download') {
                    const removeComments = document.getElementById('opt-remove-comments').checked;
                    const removeEmpty = document.getElementById('opt-remove-empty').checked;
                    const ext = path.includes('.') ? '.' + path.split('.').pop().toLowerCase() : '';

                    const optimizedContent = optimizeCode(content, ext, removeComments, removeEmpty);

                    outputContent += "===\n";
                    outputContent += `File: ${path}\n`;
                    outputContent += "===\n";
                    outputContent += optimizedContent + "\n\n";
                }
            } else {
                statsCache[path] = { lines: 0, code: 0 };
                if (mode === 'download') outputContent += `\n!!! FAILED TO READ: ${path} !!!\n`;
            }
        }

        statTotalEl.innerText = totalLinesCount.toLocaleString();
        statCodeEl.innerText = codeLinesCount.toLocaleString();

        if (mode === 'stats') {
            generateTree();
        }

        if (mode === 'download') {
            // --- UPDATED FILENAME LOGIC ---
            let filename = "project_bundle.txt";

            if (githubRepoMeta) {
                // 1. GitHub
                filename = `${githubRepoMeta.repo}.txt`;
            } else if (isZipMode && currentZipName) {
                // 2. ZIP (uses global variable)
                filename = `${currentZipName}.txt`;
            } else if (globalFileList && globalFileList.length > 0) {
                // 3. Local Folder
                const firstPath = globalFileList[0].webkitRelativePath;
                if (firstPath) {
                    const rootParts = firstPath.split('/');
                    if (rootParts.length > 0) {
                        filename = `${rootParts[0]}.txt`;
                    }
                }
            }

            downloadAsFile(filename, outputContent);
        }

        statusText.innerText = "Готово!";
        setTimeout(() => statusDiv.classList.add('hidden'), 1000);

    } catch (e) {
        alert("Критическая ошибка: " + e.message);
        console.error(e);
        statusDiv.classList.add('hidden');
    }
}

/* --- RETRY LOGIC --- */
async function fetchWithRetry(url, headers, retries = 3, delay = 1000) {
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetch(url, { headers });
            if (res.status === 403) {
                const remaining = res.headers.get('x-ratelimit-remaining');
                if (remaining === '0') throw new Error("GitHub Rate Limit Exceeded (403)");
            }
            if (!res.ok) {
                if (res.status === 404) throw new Error("404 Not Found");
                throw new Error(`Status ${res.status}`);
            }
            return res;
        } catch (err) {
            const isLastAttempt = i === retries - 1;
            if (isLastAttempt) throw err;
            await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
        }
    }
}

function downloadAsFile(filename, text) {
    const element = document.createElement('a');
    element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(text));
    element.setAttribute('download', filename);
    element.style.display = 'none';
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
}

function optimizeCode(content, ext, removeComments, removeEmpty) {
    let result = content;

    if (removeComments) {
        if (['.js', '.ts', '.jsx', '.tsx', '.css', '.scss', '.java', '.c', '.cpp', '.cs', '.php'].includes(ext)) {
            result = result.replace(/\/\*[\s\S]*?\*\//g, '');
            result = result.replace(/^(\s*)\/\/.*$/gm, '$1');
        }
        else if (['.py', '.rb', '.sh', '.yaml', '.yml', '.dockerfile'].includes(ext)) {
            result = result.replace(/^(\s*)#.*$/gm, '$1');
        }
        else if (['.html', '.xml', '.svg'].includes(ext)) {
            result = result.replace(/<!--[\s\S]*?-->/g, '');
        }
    }

    if (removeEmpty) {
        result = result.split('\n').filter(line => line.trim() !== '').join('\n');
    }

    return result.trim();
}

/* --- NEW FEATURE: SAVE SELECTION --- */
// Функция сохраняет текущие выбранные пути перед обновлением
function saveCurrentSelection() {
    const checkedBoxes = document.querySelectorAll('input[type="checkbox"][data-type="file"]:checked');
    if (checkedBoxes.length > 0) {
        lastSelectedPaths = new Set(Array.from(checkedBoxes).map(cb => cb.dataset.path));
        console.log(`Saved ${lastSelectedPaths.size} file selections.`);
    } else {
        lastSelectedPaths = null;
    }
}
