/* --- CONFIGURATION --- */
const IGNORED_FOLDERS = [
    '.git', '.idea', '.vscode', '.github', '.gitlab',
    'node_modules', 'vendor', 'bower_components',
    'dist', 'build', 'out', 'target', 'bin', 'obj',
    'coverage', '__pycache__', '.next', '.nuxt', '.cache',
    'venv', 'env', '.mypy_cache', '.ds_store'
];

// Добавьте в IGNORED_FOLDERS или сделайте массив IGNORED_FILES
const IGNORED_FILES = [
    'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
    'composer.lock', 'Cargo.lock', '.DS_Store', 'thumbs.db'
];

// В функции createNode добавьте проверку:
if (IGNORED_FILES.includes(name.toLowerCase())) isChecked = false;

const ALLOWED_EXTENSIONS = [
    // Web & Scripting
    '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.vue', '.svelte',
    '.html', '.htm', '.css', '.scss', '.sass', '.less',
    '.php', '.py', '.rb', '.pl', '.pm', '.go', '.rs', '.dart', '.lua',
    // App & System
    '.java', '.kt', '.kts', '.swift', '.c', '.cpp', '.h', '.hpp', '.cs', '.sh', '.bat', '.cmd', '.ps1',
    // Data & Config
    '.json', '.yaml', '.yml', '.toml', '.xml', '.sql', '.graphql', '.env.example',
    // Docs
    '.md', '.mdx', '.txt', '.rst'
];

/* --- GLOBAL STATE --- */
let allPaths = [];
let treeDataRoot = {};
let globalFileList = null;
let githubRepoMeta = null;

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

/* --- LOAD DATA (FIXED & UPDATED) --- */
async function fetchGitHubRepo() {
    const urlInput = document.getElementById('repoUrl').value.trim();
    let token = document.getElementById('repoToken').value.trim();

    if (!urlInput) return alert("Введите URL репозитория");

    // 1. Очистка токена
    if (token.toLowerCase().startsWith('bearer ')) {
        token = token.slice(7).trim();
    }

    // 2. Очистка URL
    const cleanUrl = urlInput.replace(/\/$/, '').replace('.git', '');
    const match = cleanUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);

    if (!match) return alert("Некорректная ссылка GitHub. Формат: https://github.com/user/repo");

    const owner = match[1];
    const repo = match[2];

    const tokenUrl = "https://github.com/settings/tokens";

    try {
        const headers = {
            'Accept': 'application/vnd.github.v3+json'
        };
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        // 1. Проверяем репозиторий
        const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });

        if (!repoRes.ok) {
            if (repoRes.status === 404) throw new Error(`Репозиторий не найден (404).\nЕсли это приватный репозиторий, создайте токен здесь:\n${tokenUrl}`);
            if (repoRes.status === 401) throw new Error(`Ошибка авторизации (401). Токен недействителен.\nПолучить новый: ${tokenUrl}`);
            if (repoRes.status === 403) {
                if (!token) {
                    throw new Error(`Превышен лимит запросов GitHub для гостей (60/час).\nПожалуйста, создайте токен (лимит 5000/час) здесь:\n${tokenUrl}`);
                } else {
                    throw new Error(`Доступ запрещен (403). Токену не хватает прав или лимит исчерпан.\nПроверьте права токена: ${tokenUrl}`);
                }
            }
            throw new Error(`Ошибка GitHub API: ${repoRes.status}`);
        }

        const repoData = await repoRes.json();
        githubRepoMeta = { owner, repo, branch: repoData.default_branch, token };
        globalFileList = null;

        // 2. Загружаем дерево файлов
        const treeRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${repoData.default_branch}?recursive=1`, { headers });

        if (!treeRes.ok) {
            if (treeRes.status === 403 && !token) throw new Error(`Превышен лимит API при загрузке дерева.\nИспользуйте токен: ${tokenUrl}`);
            throw new Error("Не удалось получить структуру файлов.");
        }

        const treeData = await treeRes.json();
        if (treeData.truncated) alert("Репозиторий очень большой, показаны не все файлы.");

        allPaths = treeData.tree
            .filter(item => item.type === 'blob')
            .map(item => item.path);

        if (allPaths.length === 0) return alert("Репозиторий пуст.");

        initializeTree(allPaths);

    } catch (e) {
        alert("ОШИБКА:\n" + e.message);
        console.error(e);
    }
}

document.getElementById('folderInput').addEventListener('change', (e) => {
    const files = e.target.files;
    allPaths = [];
    globalFileList = files;
    githubRepoMeta = null;
    for (let i = 0; i < files.length; i++) {
        if (files[i].webkitRelativePath) allPaths.push(files[i].webkitRelativePath);
    }
    if (allPaths.length > 0) initializeTree(allPaths);
});

/* --- BUILD SELECTION TREE --- */
function initializeTree(paths) {
    document.getElementById('file-list').innerHTML = '';
    document.getElementById('tree-output-container').innerHTML = '';
    document.getElementById('stat-total-lines').innerText = '0';
    document.getElementById('stat-code-lines').innerText = '0';

    treeDataRoot = buildTreeObject(paths);
    const container = document.getElementById('file-list');

    const rootUl = document.createElement('ul');
    rootUl.className = 'selection-tree';

    const keys = Object.keys(treeDataRoot).sort(sortItems(treeDataRoot));
    keys.forEach(key => {
        rootUl.appendChild(createNode(key, treeDataRoot[key], '', true));
    });
    container.appendChild(rootUl);

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

/* --- FILTERS --- */
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

    setTimeout(() => {
        document.getElementById('result-section').scrollIntoView({ behavior: 'smooth' });
    }, 100);
}

function renderCurrentView() {
    const mode = document.getElementById('view-mode').value;
    const container = document.getElementById('tree-output-container');
    container.innerHTML = '';
    if (mode === 'vertical') {
        container.innerHTML = `<div class="vertical-tree">${renderVerticalRecursive(finalResultObject, true)}</div>`;
    } else if (mode === 'ascii') {
        const pre = document.createElement('pre');
        pre.className = 'ascii-tree';
        pre.textContent = renderASCIIRecursive(finalResultObject);
        container.appendChild(pre);
    }
}

function renderVerticalRecursive(node, isRoot) {
    if (!node) return '';
    let html = isRoot ? '<ul>' : '<ul>';
    const keys = Object.keys(node).sort(sortItems(node));
    keys.forEach(key => {
        const isFolder = node[key] !== null;
        const icon = isFolder ? '<i class="fa-solid fa-folder"></i>' : '<i class="fa-regular fa-file"></i>';
        html += `<li><div class="tree-row">${icon} <span>${key}</span></div>${isFolder ? renderVerticalRecursive(node[key], false) : ''}</li>`;
    });
    return html + '</ul>';
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

/* --- PROCESS FILES (COUNT & DOWNLOAD) --- */
async function processFiles(mode) {
    const checkedFiles = Array.from(document.querySelectorAll('input[type="checkbox"][data-type="file"]:checked'))
        .map(cb => cb.dataset.path);

    if (checkedFiles.length === 0) return alert("Ничего не выбрано!");

    if (githubRepoMeta && checkedFiles.length > 50) {
        if (!confirm(`Выбрано ${checkedFiles.length} файлов. Это потребует времени для скачивания/анализа. Продолжить?`)) return;
    }

    const statusDiv = document.getElementById('loading-status');
    const statusText = document.getElementById('loading-text');
    const statTotalEl = document.getElementById('stat-total-lines');
    const statCodeEl = document.getElementById('stat-code-lines');

    // Сброс счетчиков
    let totalLinesCount = 0;
    let codeLinesCount = 0;
    statTotalEl.innerText = '0';
    statCodeEl.innerText = '0';

    statusDiv.classList.remove('hidden');

    let outputContent = "";
    // Генерируем дерево только для режима скачивания
    if (mode === 'download') {
        const treeObj = buildTreeObject(checkedFiles);
        const treeString = renderASCIIRecursive(treeObj);
        outputContent += "PROJECT DIRECTORY STRUCTURE:\n";
        outputContent += treeString;
        outputContent += "\n\n";
    }

    try {
        for (let i = 0; i < checkedFiles.length; i++) {
            const path = checkedFiles[i];
            const actionText = mode === 'download' ? "Скачивание" : "Анализ";
            statusText.innerText = `${actionText}: ${i + 1}/${checkedFiles.length} (${path})`;

            let content = "";
            let fetchSuccess = false;

            // Логика получения файла (GitHub или Local)
            if (githubRepoMeta) {
                const url = `https://api.github.com/repos/${githubRepoMeta.owner}/${githubRepoMeta.repo}/contents/${path}?ref=${githubRepoMeta.branch}`;
                const headers = { 'Accept': 'application/vnd.github.v3+json' };
                if (githubRepoMeta.token) {
                    headers['Authorization'] = `Bearer ${githubRepoMeta.token}`;
                }

                const res = await fetch(url, { headers });
                if (res.ok) {
                    const data = await res.json();
                    if (data.encoding === 'base64') {
                        // Исправление для корректного декодирования UTF-8
                        content = new TextDecoder().decode(Uint8Array.from(atob(data.content), c => c.charCodeAt(0)));
                    } else {
                        content = atob(data.content);
                    }
                    fetchSuccess = true;
                } else {
                    console.error(`Ошибка при загрузке ${path}: ${res.status}`);
                    if (res.status === 403 && !githubRepoMeta.token) {
                        const tokenUrl = "https://github.com/settings/tokens";
                        alert(`Достигнут лимит скачивания файлов (API Rate Limit).\n\nЧтобы продолжить, получите токен здесь:\n${tokenUrl}\n\nИ перезагрузите страницу.`);
                        break;
                    }
                }
            } else if (globalFileList) {
                let fileObj = null;
                for (let j = 0; j < globalFileList.length; j++) {
                    if (globalFileList[j].webkitRelativePath === path) { fileObj = globalFileList[j]; break; }
                }
                if (fileObj) {
                    try {
                        content = await fileObj.text();
                        fetchSuccess = true;
                    } catch (e) { console.error(e); }
                }
            }

            if (fetchSuccess) {
                // --- ИСПРАВЛЕНИЕ: ПОДСЧЕТ СТРОК ---
                const lines = content.split('\n');
                totalLinesCount += lines.length;

                // Считаем строки, которые не пустые (после trim)
                const nonEmptyCount = lines.filter(line => line.trim() !== '').length;
                codeLinesCount += nonEmptyCount;

                // Обновляем UI сразу же
                statTotalEl.innerText = totalLinesCount.toLocaleString();
                statCodeEl.innerText = codeLinesCount.toLocaleString();
                // ----------------------------------

                if (mode === 'download') {
                    const removeComments = document.getElementById('opt-remove-comments').checked;
                    const removeEmpty = document.getElementById('opt-remove-empty').checked;
                    const ext = '.' + path.split('.').pop().toLowerCase();

                    const optimizedContent = optimizeCode(content, ext, removeComments, removeEmpty);

                    outputContent += "===\n";
                    outputContent += `File: ${path}\n`;
                    outputContent += "===\n";
                    outputContent += optimizedContent + "\n\n";
                }
            } else {
                if (mode === 'download') outputContent += `\n!!! FAILED TO READ: ${path} !!!\n`;
            }
        }

        if (mode === 'download') {
            downloadAsFile("project_bundle.txt", outputContent);
        }

        // Завершение
        statusText.innerText = "Готово!";
        setTimeout(() => statusDiv.classList.add('hidden'), 2000);

    } catch (e) {
        alert("Ошибка в процессе обработки: " + e.message);
        statusDiv.classList.add('hidden');
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

/* Добавьте эту функцию в конец script.js или в блок helpers */
function optimizeCode(content, ext, removeComments, removeEmpty) {
    let result = content;

    // 1. Удаление комментариев (Базовая реализация на Regex)
    if (removeComments) {
        // Осторожно с Regex, это базовая версия.
        // Для JS, TS, C, Java, CSS и т.д.
        if (['.js', '.ts', '.jsx', '.tsx', '.css', '.scss', '.java', '.c', '.cpp', '.cs', '.php'].includes(ext)) {
            // Удаляем блоки /* ... */
            result = result.replace(/\/\*[\s\S]*?\*\//g, '');
            // Удаляем однострочные // (но стараемся не трогать URL http://)
            result = result.replace(/^(\s*)\/\/.*$/gm, '$1');
        }
        // Для Python, Ruby, Shell, YAML (.py, .rb, .sh, .yaml)
        else if (['.py', '.rb', '.sh', '.yaml', '.yml', '.dockerfile'].includes(ext)) {
            result = result.replace(/^(\s*)#.*$/gm, '$1');
        }
        // Для HTML/XML
        else if (['.html', '.xml', '.svg'].includes(ext)) {
            result = result.replace(/<!--[\s\S]*?-->/g, '');
        }
    }

    // 2. Удаление пустых строк
    if (removeEmpty) {
        // Разбиваем на строки, фильтруем пустые (или содержащие только пробелы), собираем обратно
        result = result.split('\n').filter(line => line.trim() !== '').join('\n');
    }

    return result.trim();
}