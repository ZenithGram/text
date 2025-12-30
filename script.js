/* --- GLOBAL STATE --- */
let allPaths = [];
let treeDataRoot = {};
let globalFileList = null;
let githubRepoMeta = null;

/* --- THEME TOGGLE --- */
document.addEventListener('DOMContentLoaded', () => {
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
    updateThemeIcon(true);
  }
});

function toggleTheme() {
  const html = document.documentElement;
  const currentTheme = html.getAttribute('data-theme');
  if (currentTheme === 'light') {
    html.removeAttribute('data-theme');
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

/* --- LOAD DATA --- */
async function fetchGitHubRepo() {
  const url = document.getElementById('repoUrl').value;
  const token = document.getElementById('repoToken').value;

  if (!url) return alert("Введите URL репозитория");
  const match = url.match(/github\.com\/([^\/]+)\/([^\/]+)/);
  if (!match) return alert("Некорректная ссылка GitHub");
  const [_, owner, repoName] = match;
  const repo = repoName.replace('.git', '');

  try {
    const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    });
    if (!repoRes.ok) throw new Error("Репозиторий не найден");
    const repoData = await repoRes.json();

    githubRepoMeta = { owner, repo, branch: repoData.default_branch, token };
    globalFileList = null;

    const treeRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${repoData.default_branch}?recursive=1`, {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    });
    const treeData = await treeRes.json();
    if (treeData.truncated) alert("Репозиторий очень большой, показаны не все файлы.");

    allPaths = treeData.tree.map(item => item.path);
    initializeTree(allPaths);

  } catch (e) {
    alert("Ошибка: " + e.message);
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
  treeDataRoot = buildTreeObject(paths);
  const container = document.getElementById('file-list');
  container.innerHTML = '';
  const rootUl = document.createElement('ul');
  rootUl.className = 'selection-tree';

  const keys = Object.keys(treeDataRoot).sort(sortItems(treeDataRoot));
  keys.forEach(key => {
    rootUl.appendChild(createNode(key, treeDataRoot[key], ''));
  });
  container.appendChild(rootUl);

  renderExtensions(paths);
  document.getElementById('selection-section').classList.remove('hidden');
  document.getElementById('result-section').classList.add('hidden');

  // Обновляем счетчик
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
function createNode(name, data, parentPath) {
  const li = document.createElement('li');
  const fullPath = parentPath ? `${parentPath}/${name}` : name;
  const isFolder = data !== null;

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
  checkbox.checked = true;

  checkbox.onclick = (e) => {
    const isChecked = e.target.checked;
    if (isFolder) {
      const children = li.querySelectorAll('input[type="checkbox"]');
      children.forEach(child => {
        child.checked = isChecked;
        child.indeterminate = false;
      });
    }
    updateAncestors(checkbox);
    updateSelectionCount(); // Обновляем счетчик
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
      ul.appendChild(createNode(key, data[key], fullPath));
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

// НОВАЯ ФУНКЦИЯ СЧЕТЧИКА
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
  updateSelectionCount(); // Обновляем счетчик
}

function toggleAll(state) {
  document.querySelectorAll('#file-list input[type="checkbox"]').forEach(cb => {
    cb.checked = state;
    cb.indeterminate = false;
  });
  updateSelectionCount(); // Обновляем счетчик
}

/* --- GENERATE --- */
let finalResultObject = {};

function generateTree() {
  const checkedFiles = Array.from(document.querySelectorAll('input[type="checkbox"][data-type="file"]:checked'))
    .map(cb => cb.dataset.path);

  if (checkedFiles.length === 0) return alert("Ничего не выбрано!");

  finalResultObject = buildTreeObject(checkedFiles);
  renderCurrentView();

  document.getElementById('result-section').classList.remove('hidden');
  document.getElementById('tree-output-container').scrollIntoView({ behavior: 'smooth' });
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

/* --- DOWNLOAD --- */
async function downloadCombinedFile() {
  const checkedFiles = Array.from(document.querySelectorAll('input[type="checkbox"][data-type="file"]:checked'))
    .map(cb => cb.dataset.path);

  if (checkedFiles.length === 0) return alert("Ничего не выбрано!");
  if (checkedFiles.length > 50 && githubRepoMeta) {
    if (!confirm(`Выбрано ${checkedFiles.length} файлов. Загрузка с GitHub может занять время. Продолжить?`)) return;
  }

  const statusDiv = document.getElementById('loading-status');
  const statusText = document.getElementById('loading-text');
  statusDiv.classList.remove('hidden');

  let outputContent = "PROJECT STRUCTURE:\n";
  outputContent += "================================================================\n";
  const treeObj = buildTreeObject(checkedFiles);
  outputContent += renderASCIIRecursive(treeObj);
  outputContent += "\n\n";

  try {
    if (githubRepoMeta) {
      for (let i = 0; i < checkedFiles.length; i++) {
        const path = checkedFiles[i];
        statusText.innerText = `Загрузка: ${i + 1}/${checkedFiles.length} (${path})`;
        const url = `https://api.github.com/repos/${githubRepoMeta.owner}/${githubRepoMeta.repo}/contents/${path}?ref=${githubRepoMeta.branch}`;
        const headers = githubRepoMeta.token ? { 'Authorization': `Bearer ${githubRepoMeta.token}` } : {};
        const res = await fetch(url, { headers });
        if (res.ok) {
          const data = await res.json();
          const content = new TextDecoder().decode(Uint8Array.from(atob(data.content), c => c.charCodeAt(0)));
          outputContent += `\n================================================================\nFILE: ${path}\n================================================================\n${content}\n`;
        } else {
          outputContent += `\n!!! FAILED TO FETCH: ${path} !!!\n`;
        }
      }
    } else if (globalFileList) {
      for (let i = 0; i < checkedFiles.length; i++) {
        const path = checkedFiles[i];
        statusText.innerText = `Обработка: ${i + 1}/${checkedFiles.length} (${path})`;
        let fileObj = null;
        for (let j = 0; j < globalFileList.length; j++) {
          if (globalFileList[j].webkitRelativePath === path) { fileObj = globalFileList[j]; break; }
        }
        if (fileObj) {
          try {
            const content = await fileObj.text();
            outputContent += `\n================================================================\nFILE: ${path}\n================================================================\n${content}\n`;
          } catch (e) {
            outputContent += `\n!!! ERROR READING LOCAL FILE: ${path} !!!\n`;
          }
        }
      }
    }
    downloadAsFile("project_bundle.txt", outputContent);
  } catch (e) {
    alert("Ошибка: " + e.message);
  } finally {
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