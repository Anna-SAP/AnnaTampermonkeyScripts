// ==UserScript==
// @name         Jira × Tranzor MR annotator
// @name:zh-CN   Jira 页标注关联的 Tranzor task
// @namespace    https://github.com/Anna-SAP/AnnaTampermonkeyScripts
// @version      1.0.0
// @description  On Jira issue pages, annotate each linked GitLab MR with its Tranzor MR-pipeline task (if any) and a dashboard link. Also works on GitLab MR pages.
// @description:zh-CN  打开带 GitLab MR 的 Jira 票时，在 Issue Links 后标注对应的 Tranzor MR Pipeline task、状态、字符串条数和 Dashboard 链接；GitLab MR 页同样显示。
// @author       Anna-SAP
// @match        https://jira.ringcentral.com/*
// @match        https://git.ringcentral.com/*
// @match        http://tranzor-platform.int.rclabenv.com/*
// @match        http://tranzor-platform-stage.int.rclabenv.com/*
// @match        https://tranzor-platform.int.rclabenv.com/*
// @match        https://tranzor-platform-stage.int.rclabenv.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=jira.ringcentral.com
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM.xmlHttpRequest
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.registerMenuCommand
// @connect      tranzor-platform.int.rclabenv.com
// @connect      tranzor-platform-stage.int.rclabenv.com
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/Anna-SAP/AnnaTampermonkeyScripts/main/jira-tranzor-mr-annotator.user.js
// @downloadURL  https://raw.githubusercontent.com/Anna-SAP/AnnaTampermonkeyScripts/main/jira-tranzor-mr-annotator.user.js
// ==/UserScript==

(function () {
  'use strict';

  const NS = 'tz-ann';
  const CACHE_TTL_MS = 5 * 60 * 1000;
  const MR_URL_RE = /https?:\/\/git\.ringcentral\.com\/(.+?)\/-\/merge_requests\/(\d+)/i;
  const JIRA_KEY_RE = /\b([A-Z][A-Z0-9]+-\d+)\b/;
  const ENVS = {
    prod: {
      label: 'prod',
      origin: 'http://tranzor-platform.int.rclabenv.com',
    },
    stage: {
      label: 'stage',
      origin: 'http://tranzor-platform-stage.int.rclabenv.com',
    },
  };

  const gm = {
    get(key, fallback) {
      try {
        if (typeof GM !== 'undefined' && typeof GM.getValue === 'function') {
          return Promise.resolve(GM.getValue(key, fallback));
        }
      } catch (_) { /* ignore */ }
      if (typeof GM_getValue === 'function') return Promise.resolve(GM_getValue(key, fallback));
      return Promise.resolve(fallback);
    },
    set(key, value) {
      try {
        if (typeof GM !== 'undefined' && typeof GM.setValue === 'function') {
          return Promise.resolve(GM.setValue(key, value));
        }
      } catch (_) { /* ignore */ }
      if (typeof GM_setValue === 'function') {
        GM_setValue(key, value);
        return Promise.resolve();
      }
      return Promise.resolve();
    },
    xhr(opts) {
      const fn =
        (typeof GM !== 'undefined' && GM.xmlHttpRequest) ||
        (typeof GM_xmlhttpRequest === 'function' ? GM_xmlhttpRequest : null);
      if (!fn) return Promise.reject(new Error('GM.xmlHttpRequest unavailable'));
      return new Promise((resolve, reject) => {
        fn({
          method: opts.method || 'GET',
          url: opts.url,
          headers: opts.headers || {},
          timeout: opts.timeout || 20000,
          onload: resolve,
          onerror: (e) => reject(e || new Error('network error')),
          ontimeout: () => reject(new Error('timeout')),
        });
      });
    },
    menu(title, fn) {
      try {
        if (typeof GM !== 'undefined' && typeof GM.registerMenuCommand === 'function') {
          GM.registerMenuCommand(title, fn);
          return;
        }
      } catch (_) { /* ignore */ }
      if (typeof GM_registerMenuCommand === 'function') GM_registerMenuCommand(title, fn);
    },
  };

  function hostIsTranzor() {
    return /tranzor-platform(-stage)?\.int\.rclabenv\.com$/i.test(location.hostname);
  }

  function hostIsJira() {
    return location.hostname === 'jira.ringcentral.com';
  }

  function hostIsGitLab() {
    return location.hostname === 'git.ringcentral.com';
  }

  function parseMrUrl(url) {
    if (!url) return null;
    const match = String(url).match(MR_URL_RE);
    if (!match) return null;
    return {
      projectId: match[1],
      mrIid: Number(match[2]),
      url: `https://git.ringcentral.com/${match[1]}/-/merge_requests/${match[2]}`,
    };
  }

  function extractJiraKey(text) {
    const match = String(text || '').match(JIRA_KEY_RE);
    return match ? match[1].toUpperCase() : null;
  }

  function currentJiraKey() {
    const fromPath =
      location.pathname.match(/\/browse\/([A-Z][A-Z0-9]+-\d+)/i) ||
      location.pathname.match(/\/issues\/([A-Z][A-Z0-9]+-\d+)/i);
    if (fromPath) return fromPath[1].toUpperCase();
    const selected = new URLSearchParams(location.search).get('selectedIssue');
    if (selected && JIRA_KEY_RE.test(selected)) return selected.toUpperCase();
    const keyEl = document.getElementById('key-val') || document.getElementById('issuekey-val');
    if (keyEl) {
      const key = extractJiraKey(keyEl.textContent);
      if (key) return key;
    }
    return null;
  }

  function currentGitLabMr() {
    return parseMrUrl(location.href);
  }

  function mrKey(mr) {
    return `${mr.projectId}!${mr.mrIid}`;
  }

  function dashboardUrl(origin, mr) {
    const params = new URLSearchParams();
    params.set('project_id', mr.projectId);
    params.set('mr_id', String(mr.mrIid));
    return `${origin}/static/?${params.toString()}`;
  }

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.entries(attrs).forEach(([name, value]) => {
        if (value == null || value === false) return;
        if (name === 'className') node.className = value;
        else if (name === 'text') node.textContent = value;
        else if (name.slice(0, 2) === 'on' && typeof value === 'function') {
          node.addEventListener(name.slice(2).toLowerCase(), value);
        } else {
          node.setAttribute(name, value === true ? '' : String(value));
        }
      });
    }
    (children || []).forEach((child) => {
      if (child == null) return;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return node;
  }

  function ensureStyles() {
    if (document.getElementById(`${NS}-style`)) return;
    const css = `
      .${NS}-panel { font: 12px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #172b4d; }
      .${NS}-module { border: 1px solid #dfe1e6; border-radius: 4px; background: #fff; margin: 12px 0; }
      .${NS}-hd { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: #fff7ed; border-bottom: 1px solid #fed7aa; }
      .${NS}-hd b { color: #c2410c; font-size: 13px; }
      .${NS}-hd .${NS}-grow { flex: 1; }
      .${NS}-btn { cursor: pointer; border: 1px solid #dfe1e6; background: #fff; border-radius: 3px; padding: 1px 7px; font-size: 11px; color: #42526e; }
      .${NS}-btn:hover { background: #f4f5f7; }
      .${NS}-bd { padding: 8px 12px 10px; }
      .${NS}-note { color: #6b778c; margin: 0 0 8px; }
      .${NS}-warn { color: #b45309; margin: 0 0 8px; }
      .${NS}-err { color: #ae2a19; margin: 0 0 8px; }
      .${NS}-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; padding: 6px 0; border-top: 1px dashed #ebecf0; }
      .${NS}-row:first-child { border-top: 0; }
      .${NS}-mr { font-weight: 600; color: #172b4d; text-decoration: none; }
      .${NS}-mr:hover { text-decoration: underline; }
      .${NS}-title { color: #5e6c84; }
      .${NS}-pill { display: inline-flex; align-items: center; gap: 4px; border-radius: 999px; padding: 1px 8px; font-size: 11px; font-weight: 600; white-space: nowrap; }
      .${NS}-pill a { color: inherit; text-decoration: underline; }
      .${NS}-none { background: #f4f5f7; color: #6b778c; }
      .${NS}-ok { background: #e3fcef; color: #006644; }
      .${NS}-run { background: #fff0b3; color: #974f0c; }
      .${NS}-fail { background: #ffebe6; color: #bf2600; }
      .${NS}-other { background: #fff7ed; color: #c2410c; }
      .${NS}-inline { margin-left: 8px; vertical-align: middle; }
      .${NS}-toast { position: fixed; right: 16px; bottom: 16px; z-index: 99999; background: #172b4d; color: #fff; padding: 8px 12px; border-radius: 4px; font-size: 12px; }
      .${NS}-gl { margin: 12px 0; }
    `;
    document.head.appendChild(el('style', { id: `${NS}-style`, text: css }));
  }

  async function captureTranzorToken() {
    const token = window.localStorage.getItem('tranzor_token');
    if (!token) return false;
    const env = location.hostname.includes('stage') ? 'stage' : 'prod';
    await gm.set('tranzor_env', env);
    await gm.set(`tranzor_token_${env}`, token);
    await gm.set('tranzor_token_at', Date.now());
    return true;
  }

  function toast(message) {
    ensureStyles();
    const old = document.getElementById(`${NS}-toast`);
    if (old) old.remove();
    const node = el('div', { id: `${NS}-toast`, className: `${NS}-toast panel ${NS}-panel`, text: message });
    document.body.appendChild(node);
    setTimeout(() => node.remove(), 3500);
  }

  async function getEnv() {
    const saved = await gm.get('tranzor_env', 'prod');
    return ENVS[saved] ? saved : 'prod';
  }

  async function lookupTranzor(mr, envName) {
    const env = ENVS[envName];
    const token = await gm.get(`tranzor_token_${envName}`, '');
    if (!token) {
      return { state: 'no-token' };
    }
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    };
    const mrsUrl =
      `${env.origin}/api/v1/dashboard/mrs` +
      `?project_id=${encodeURIComponent(mr.projectId)}` +
      `&mr_id=${encodeURIComponent(mr.mrIid)}` +
      `&summary_mode=metadata`;
    const listResp = await gm.xhr({ url: mrsUrl, headers });
    if (listResp.status === 401 || listResp.status === 403) {
      return { state: 'auth' };
    }
    if (listResp.status < 200 || listResp.status >= 300) {
      return { state: 'error', message: `HTTP ${listResp.status}` };
    }
    let payload = {};
    try {
      payload = JSON.parse(listResp.responseText || '{}');
    } catch (_) {
      return { state: 'error', message: 'invalid JSON' };
    }
    const hit = Array.isArray(payload.mrs) ? payload.mrs[0] : null;
    if (!hit) {
      return { state: 'none' };
    }

    const detailUrl =
      `${env.origin}/api/v1/dashboard/mr-cases` +
      `?project_id=${encodeURIComponent(mr.projectId)}` +
      `&mr_id=${encodeURIComponent(mr.mrIid)}` +
      `&limit=1&stats_mode=defer`;
    let taskId = null;
    let caseCount = typeof hit.case_count === 'number' ? hit.case_count : 0;
    let taskStatus = hit.task_status || '';
    try {
      const detailResp = await gm.xhr({ url: detailUrl, headers });
      if (detailResp.status >= 200 && detailResp.status < 300) {
        const detail = JSON.parse(detailResp.responseText || '{}');
        taskId = detail.task_id || null;
        if (typeof detail.case_count === 'number') caseCount = detail.case_count;
        if (detail.task_status) taskStatus = detail.task_status;
      }
    } catch (_) { /* metadata is enough */ }

    return {
      state: 'hit',
      taskId,
      taskStatus,
      caseCount,
      hasCases: Boolean(hit.has_cases) || caseCount > 0,
      dashboard: dashboardUrl(env.origin, mr),
    };
  }

  async function jiraJson(path) {
    const resp = await fetch(path, { credentials: 'include', headers: { Accept: 'application/json' } });
    if (!resp.ok) throw new Error(`${path} HTTP ${resp.status}`);
    return resp.json();
  }

  async function collectJiraMrs(issueKey) {
    const byKey = new Map();
    const add = (url, title) => {
      const mr = parseMrUrl(url);
      if (!mr) return;
      const key = mrKey(mr);
      const prev = byKey.get(key) || { ...mr, title: '', jiraInTitle: null };
      if (title && title.length > (prev.title || '').length) prev.title = title;
      prev.jiraInTitle = extractJiraKey(prev.title || title || '');
      byKey.set(key, prev);
    };

    try {
      const links = await jiraJson(`/rest/api/2/issue/${encodeURIComponent(issueKey)}/remotelink`);
      (Array.isArray(links) ? links : []).forEach((link) => {
        const obj = link && link.object;
        if (!obj) return;
        add(obj.url, obj.title || '');
      });
    } catch (_) { /* fall through to DOM / comments */ }

    try {
      const issue = await jiraJson(
        `/rest/api/2/issue/${encodeURIComponent(issueKey)}?fields=comment,summary`,
      );
      const comments = (((issue.fields || {}).comment || {}).comments) || [];
      comments.forEach((comment) => {
        const body = comment.body || '';
        const found = body.match(new RegExp(MR_URL_RE.source, 'gi')) || [];
        found.forEach((url) => add(url, ''));
      });
    } catch (_) { /* ignore */ }

    document.querySelectorAll('a[href*="git.ringcentral.com"][href*="/-/merge_requests/"]').forEach((anchor) => {
      add(anchor.href, anchor.textContent || '');
    });

    return [...byKey.values()].sort((a, b) => {
      if (a.projectId !== b.projectId) return a.projectId.localeCompare(b.projectId);
      return a.mrIid - b.mrIid;
    });
  }

  function pillFor(result, envOrigin, mr) {
    if (!result || result.state === 'no-token') {
      return el('span', { className: `${NS}-pill ${NS}-none` }, [
        '待登录 Tranzor · ',
        el('a', { href: `${envOrigin}/static/`, target: '_blank', rel: 'noreferrer', text: '打开 Dashboard' }),
      ]);
    }
    if (result.state === 'auth') {
      return el('span', { className: `${NS}-pill ${NS}-fail`, text: 'Tranzor 登录已过期' });
    }
    if (result.state === 'error') {
      return el('span', { className: `${NS}-pill ${NS}-fail`, text: `查询失败 ${result.message || ''}` });
    }
    if (result.state === 'none') {
      return el('span', { className: `${NS}-pill ${NS}-none` }, [
        '无 Tranzor task · ',
        el('a', { href: dashboardUrl(envOrigin, mr), target: '_blank', rel: 'noreferrer', text: '去 Dashboard 确认' }),
      ]);
    }
    const status = (result.taskStatus || 'unknown').toLowerCase();
    let kind = `${NS}-ok`;
    if (status === 'failed') kind = `${NS}-fail`;
    else if (status === 'running' || status === 'pending') kind = `${NS}-run`;
    const countLabel = result.hasCases || result.caseCount
      ? `${result.caseCount} 条`
      : '0 条';
    const idShort = result.taskId ? result.taskId.slice(0, 8) : 'task';
    return el('span', { className: `${NS}-pill ${kind}` }, [
      `Tranzor ${status} · ${countLabel} · ${idShort} · `,
      el('a', { href: result.dashboard, target: '_blank', rel: 'noreferrer', text: '打开' }),
    ]);
  }

  function renderPanel(issueKey, mrs, results, envName, tokenOk, error) {
    ensureStyles();
    const env = ENVS[envName];
    let host = document.getElementById(`${NS}-module`);
    if (!host) {
      host = el('div', { id: `${NS}-module`, className: `${NS}-module ${NS}-panel` });
      const linking = document.getElementById('linkingmodule');
      if (linking && linking.parentNode) linking.parentNode.insertBefore(host, linking);
      else {
        const details = document.getElementById('details-module') || document.getElementById('issue-content');
        if (details) details.appendChild(host);
        else document.body.appendChild(host);
      }
    }
    host.replaceChildren();

    const hitCount = mrs.filter((mr) => (results[mrKey(mr)] || {}).state === 'hit').length;
    const header = el('div', { className: `${NS}-hd` }, [
      el('b', { text: 'Tranzor tasks' }),
      el('span', { text: `${issueKey} · ${hitCount}/${mrs.length} 个 MR 有 task · ${env.label}` }),
      el('span', { className: `${NS}-grow` }),
      el('button', {
        className: `${NS}-btn`,
        type: 'button',
        text: envName === 'prod' ? '切到 stage' : '切到 prod',
        onClick: async () => {
          const next = envName === 'prod' ? 'stage' : 'prod';
          await gm.set('tranzor_env', next);
          await runJira(issueKey, { force: true });
        },
      }),
      el('button', {
        className: `${NS}-btn`,
        type: 'button',
        text: '刷新',
        onClick: () => runJira(issueKey, { force: true }),
      }),
    ]);
    const body = el('div', { className: `${NS}-bd` });
    body.appendChild(
      el('p', {
        className: `${NS}-note`,
        text: '按 GitLab project + MR iid 查询 MR Pipeline。Commit 不会建 task。标题里的 Jira 号可能和当前票不一致。',
      }),
    );
    if (!tokenOk) {
      body.appendChild(
        el('p', { className: `${NS}-warn` }, [
          '还没有 Tranzor token。请先打开 ',
          el('a', { href: `${env.origin}/static/`, target: '_blank', rel: 'noreferrer', text: 'Tranzor Dashboard' }),
          ' 登录一次，再回到本页点刷新。',
        ]),
      );
    }
    if (error) body.appendChild(el('p', { className: `${NS}-err`, text: error }));
    if (!mrs.length) {
      body.appendChild(el('p', { className: `${NS}-note`, text: '本票没有 GitLab MR remote link。' }));
    }
    mrs.forEach((mr) => {
      const result = results[mrKey(mr)];
      const other = mr.jiraInTitle && mr.jiraInTitle !== issueKey;
      const row = el('div', { className: `${NS}-row` }, [
        el('a', {
          className: `${NS}-mr`,
          href: mr.url,
          target: '_blank',
          rel: 'noreferrer',
          text: `${mr.projectId} !${mr.mrIid}`,
        }),
        mr.title ? el('span', { className: `${NS}-title`, text: mr.title.replace(/^Merge request\s*-\s*/i, '') }) : null,
        pillFor(result, env.origin, mr),
        other ? el('span', { className: `${NS}-pill ${NS}-other`, text: `标题是 ${mr.jiraInTitle}` }) : null,
      ]);
      body.appendChild(row);
    });
    host.append(header, body);
  }

  function annotateInline(mrs, results, envOrigin) {
    const byUrl = new Map();
    mrs.forEach((mr) => byUrl.set(mr.url, mr));
    document.querySelectorAll('a[href*="git.ringcentral.com"][href*="/-/merge_requests/"]').forEach((anchor) => {
      const parsed = parseMrUrl(anchor.href);
      if (!parsed) return;
      const mr = byUrl.get(parsed.url) || parsed;
      const result = results[mrKey(mr)];
      const next = anchor.nextElementSibling;
      if (next && next.getAttribute && next.getAttribute('data-tz-ann') === mrKey(mr)) next.remove();
      const badge = pillFor(result, envOrigin, mr);
      badge.classList.add(`${NS}-inline`);
      badge.setAttribute('data-tz-ann', mrKey(mr));
      anchor.insertAdjacentElement('afterend', badge);
    });
  }

  const jiraCache = new Map();
  let jiraTimer = null;
  let lastJiraKey = '';

  async function runJira(issueKey, opts) {
    if (!issueKey) return;
    const force = opts && opts.force;
    const envName = await getEnv();
    const cacheKey = `${envName}:${issueKey}`;
    const cached = jiraCache.get(cacheKey);
    if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) {
      renderPanel(issueKey, cached.mrs, cached.results, envName, cached.tokenOk, cached.error);
      annotateInline(cached.mrs, cached.results, ENVS[envName].origin);
      return;
    }
    let mrs = [];
    let error = '';
    try {
      mrs = await collectJiraMrs(issueKey);
    } catch (e) {
      error = `读取 Jira remote link 失败：${e.message || e}`;
    }
    const token = await gm.get(`tranzor_token_${envName}`, '');
    const results = {};
    for (const mr of mrs) {
      try {
        results[mrKey(mr)] = await lookupTranzor(mr, envName);
      } catch (e) {
        results[mrKey(mr)] = { state: 'error', message: String(e.message || e) };
      }
    }
    jiraCache.set(cacheKey, { at: Date.now(), mrs, results, tokenOk: Boolean(token), error, envName });
    renderPanel(issueKey, mrs, results, envName, Boolean(token), error);
    annotateInline(mrs, results, ENVS[envName].origin);
  }

  function paintCachedJira(issueKey) {
    if (!issueKey) return;
    for (const [cacheKey, cached] of jiraCache.entries()) {
      if (cacheKey.endsWith(`:${issueKey}`)) {
        annotateInline(cached.mrs, cached.results, ENVS[cached.envName || 'prod'].origin);
        return;
      }
    }
  }

  function watchJira() {
    const tick = () => {
      const key = currentJiraKey();
      if (key && key !== lastJiraKey) {
        lastJiraKey = key;
        runJira(key);
        return;
      }
      if (key) paintCachedJira(key);
    };
    tick();
    if (jiraTimer) clearInterval(jiraTimer);
    jiraTimer = setInterval(tick, 1200);
    let paintQueued = false;
    const observer = new MutationObserver(() => {
      if (paintQueued) return;
      paintQueued = true;
      setTimeout(() => {
        paintQueued = false;
        paintCachedJira(currentJiraKey());
      }, 200);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  async function runGitLab() {
    const mr = currentGitLabMr();
    if (!mr) return;
    ensureStyles();
    const envName = await getEnv();
    const env = ENVS[envName];
    let result;
    try {
      result = await lookupTranzor(mr, envName);
    } catch (e) {
      result = { state: 'error', message: String(e.message || e) };
    }
    let host = document.getElementById(`${NS}-gl`);
    if (!host) {
      host = el('div', { id: `${NS}-gl`, className: `${NS}-module ${NS}-panel ${NS}-gl` });
      const mount =
        document.querySelector('.detail-page-description') ||
        document.querySelector('.merge-request-details') ||
        document.querySelector('.content-wrapper') ||
        document.body;
      mount.insertBefore(host, mount.firstChild);
    }
    host.replaceChildren(
      el('div', { className: `${NS}-hd` }, [
        el('b', { text: 'Tranzor task' }),
        el('span', { text: `${mr.projectId} !${mr.mrIid} · ${env.label}` }),
        el('span', { className: `${NS}-grow` }),
        el('button', {
          className: `${NS}-btn`,
          type: 'button',
          text: '刷新',
          onClick: runGitLab,
        }),
      ]),
      el('div', { className: `${NS}-bd` }, [pillFor(result, env.origin, mr)]),
    );
  }

  async function main() {
    gm.menu('Tranzor: 使用 prod', async () => {
      await gm.set('tranzor_env', 'prod');
      toast('已切换到 prod');
    });
    gm.menu('Tranzor: 使用 stage', async () => {
      await gm.set('tranzor_env', 'stage');
      toast('已切换到 stage');
    });
    gm.menu('Tranzor: 清除缓存并刷新', () => {
      jiraCache.clear();
      lastJiraKey = '';
      if (hostIsJira()) runJira(currentJiraKey(), { force: true });
      if (hostIsGitLab()) runGitLab();
    });

    if (hostIsTranzor()) {
      const captured = await captureTranzorToken();
      if (captured) toast('已捕获 Tranzor 登录，可回 Jira 查看 task 标注');
      let n = 0;
      const timer = setInterval(async () => {
        n += 1;
        const ok = await captureTranzorToken();
        if (ok && n === 1) toast('已捕获 Tranzor 登录');
        if (n > 30) clearInterval(timer);
      }, 2000);
      return;
    }
    if (hostIsJira()) {
      watchJira();
      return;
    }
    if (hostIsGitLab() && /\/-\/merge_requests\/\d+/.test(location.pathname)) {
      runGitLab();
    }
  }

  main().catch((err) => {
    console.warn('[tz-ann]', err);
  });
})();
