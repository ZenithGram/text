/* --- CONFIGURATION --- */
const IGNORED_FOLDERS = [
    '.git', '.idea', '.vscode', '.github', '.gitlab',
    'node_modules', 'vendor', 'bower_components',
    'dist', 'build', 'out', 'target', 'bin', 'obj',
    'coverage', '__pycache__', '.next', '.nuxt', '.cache',
    'venv', 'env', '.mypy_cache', '.ds_store'
];

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

/* --- LOAD DATA (FIXED) --- */
/* --- LOAD DATA (UPDATED) --- */
async function fetchGitHubRepo() {
    const urlInput = document.getElementById('repoUrl').value.trim();
    let token = document.getElementById('repoToken').value.trim();

    if (!urlInput) return alert("Введите URL репозитория");

    // 1. Очистка токена от мусора
    // Если пользователь скопировал "Bearer ghp_...", убираем "Bearer "
    if (token.toLowerCase().startsWith('bearer ')) {
        token = token.slice(7).trim();
    }

    // 2. Очистка URL
    const cleanUrl = urlInput.replace(/\/$/, '').replace('.git', '');
    const match = cleanUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);

    if (!match) return alert("Некорректная ссылка GitHub. Формат: https://github.com/user/repo");

    const owner = match[1];
    const repo = match[2];

    try {
        // Формируем заголовки.
        // Важно: если токен пустой, не отправляем заголовок Authorization вообще,
        // иначе GitHub вернет 401 даже для публичных репо.
        const headers = {};
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        // 1. Проверяем репозиторий
        const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });

        if (!repoRes.ok) {
            if (repoRes.status === 401) throw new Error("Ошибка авторизации (401). Токен недействителен, просрочен или введен с ошибкой.");
            if (repoRes.status === 403) throw new Error("Доступ запрещен (403). Либо лимит API исчерпан, либо токену не хватает прав (нужны права 'repo').");
            if (repoRes.status === 404) throw new Error("Репозиторий не найден (404). Проверьте ссылку. Если репо приватный — проверьте токен.");
            throw new Error(`Ошибка GitHub API: ${repoRes.status}`);
        }

        const repoData = await repoRes.json();

        // Сохраняем метаданные
        githubRepoMeta = { owner, repo, branch: repoData.default_branch, token };
        globalFileList = null;

        // 2. Загружаем дерево файлов
        const treeRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${repoData.default_branch}?recursive=1`, { headers });

        if (!treeRes.ok) throw new Error("Не удалось получить структуру файлов.");

        const treeData = await treeRes.json();
        if (treeData.truncated) alert("Репозиторий очень большой, показаны не все файлы.");

        // Получаем пути
        allPaths = treeData.tree
            .filter(item => item.type === 'blob')
            .map(item => item.path);

        if (allPaths.length === 0) return alert("Репозиторий пуст.");

        initializeTree(allPaths);

    } catch (e) {
        alert("ОШИБКА: " + e.message);
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
    // Сброс UI перед новой отрисовкой
    document.getElementById('file-list').innerHTML = '';
    document.getElementById('tree-output-container').innerHTML = '';

    // Сброс статистики
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

    // Показываем секцию выбора
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

    // Скролл к результату
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

    let totalLinesCount = 0;
    let codeLinesCount = 0;
    statTotalEl.innerText = '0';
    statCodeEl.innerText = '0';

    statusDiv.classList.remove('hidden');

    // === СТРУКТУРА ФАЙЛА (LLM FRIENDLY) ===
    let outputContent = "";
    const treeObj = buildTreeObject(checkedFiles);
    const treeString = renderASCIIRecursive(treeObj);

    if (mode === 'download') {
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

            if (githubRepoMeta) {
                const url = `https://api.github.com/repos/${githubRepoMeta.owner}/${githubRepoMeta.repo}/contents/${path}?ref=${githubRepoMeta.branch}`;
                const headers = githubRepoMeta.token ? { 'Authorization': `Bearer ${githubRepoMeta.token}` } : {};

                const res = await fetch(url, { headers });

                if (res.ok) {
                    const data = await res.json();
                    if (data.encoding === 'base64') {
                        content = new TextDecoder().decode(Uint8Array.from(atob(data.content), c => c.charCodeAt(0)));
                    } else {
                        // Для редких случаев, если API вернет что-то иное (обычно для text файлов)
                        content = atob(data.content);
                    }
                    fetchSuccess = true;
                } else {
                    console.error(`Ошибка при загрузке ${path}: ${res.status}`);
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
                // Подсчет строк для UI (оставляем для пользователя)
                if (content.length > 0) {
                    const lines = content.split(/\r\n|\r|\n/);
                    totalLinesCount += lines.length;
                    const nonEmpty = lines.filter(l => l.trim().length > 0).length;
                    codeLinesCount += nonEmpty;
                }

                statTotalEl.innerText = totalLinesCount;
                statCodeEl.innerText = codeLinesCount;

                // Запись в файл (БЕЗ СТАТИСТИКИ, НОВЫЙ ФОРМАТ)
                if (mode === 'download') {
                    outputContent += "================================================================\n";
                    outputContent += `File: ${path}\n`;
                    outputContent += "================================================================\n";
                    outputContent += content + "\n\n";
                }
            } else {
                if (mode === 'download') outputContent += `\n!!! FAILED TO READ: ${path} !!!\n`;
            }
        }

        if (mode === 'download') {
            downloadAsFile("project_bundle.txt", outputContent);
        } else {
            statusText.innerText = "Готово!";
            setTimeout(() => statusDiv.classList.add('hidden'), 2000);
            return;
        }

    } catch (e) {
        alert("Ошибка в процессе обработки: " + e.message);
    } finally {
        if (mode === 'download') statusDiv.classList.add('hidden');
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