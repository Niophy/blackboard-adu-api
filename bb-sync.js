/* Blackboard Ultra course sync — paste into the claude-in-chrome javascript_tool.
 *
 * Prerequisite: a tab open on https://blackboard.adu.ac.ae/ultra/courses/<id>/outline
 * with the user already signed in. Never enters credentials.
 *
 * THE ONE GOTCHA: the Ultra page carries
 *     <base href="https://dmuwut6e40u5o.cloudfront.net/ultra/uiv...">
 * so every relative URL — including root-relative "/learn/api/..." — resolves to
 * CloudFront and comes back as an S3 <Error><Code>NoSuchKey</Code>. That 404 is
 * what earlier notes misread as "CSP blocks fetch()". It is not CSP. Nothing is
 * blocked. ALWAYS build absolute URLs against ORIGIN below.
 *
 * API base is the INTERNAL /learn/api/v1, not /learn/api/public/v1 (public needs a
 * developer key students cannot get; internal rides the session cookie).
 */

// ---------------------------------------------------------------------------
// SNIPPET 1 — MANIFEST. Returns every downloadable file in the course.
// ---------------------------------------------------------------------------
(async () => {
  const ORIGIN = 'https://blackboard.adu.ac.ae';
  const CID = location.pathname.match(/courses\/([^/]+)/)[1];

  const api = async (p) => {
    try {
      const r = await fetch(ORIGIN + p, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      return r.ok ? await r.json() : null;
    } catch { return null; }
  };

  const files = [], folders = [], links = [];

  async function walk(id, path, depth) {
    if (depth > 5) return;
    const kids = await api(`/learn/api/v1/courses/${CID}/contents/${id}/children?limit=200`);
    const list = Array.isArray(kids) ? kids : (kids && kids.results) || [];
    for (const k of list) {
      const p = path + '/' + k.title;
      const h = k.contentHandler || '';
      if (h.includes('folder') || h.includes('lesson')) {
        folders.push(p);
        await walk(k.id, p, depth + 1);
      } else if (h.includes('file') || h.includes('document')) {
        files.push({ id: k.id, path: p, modified: k.modifiedDate });
      } else {
        links.push({ title: k.title, kind: h.replace('resource/x-bb-', '') });
      }
    }
  }
  await walk('ROOT', '', 0);

  // Resolve each file to its real filename, byte size and permanent URL.
  const out = [];
  for (const f of files) {
    const j = await api(`/learn/api/v1/courses/${CID}/contents/${f.id}`);
    const d = j && j.contentDetail && j.contentDetail['resource/x-bb-file'];
    if (d && d.file) {
      out.push({
        name: d.file.fileName,
        bytes: +d.file.fileSize,
        url: d.file.permanentUrl,          // /bbcswebdav/pid-...-rid-..._1/xid-..._1
        folder: f.path.split('/').slice(0, -1).join('/'),
        modified: new Date(f.modified).toISOString().slice(0, 10),
      });
    }
  }
  return { courseId: CID, folders, files: out, nonFiles: links };
})();

// ---------------------------------------------------------------------------
// SNIPPET 2 — DOWNLOAD. Edit WANT to the filenames the manifest showed that the
// local folder does not have, then run. Files land in C:\Users\User\Downloads.
// No clicking, no "More options" menu, no 30-second wait, no viewer page (so no
// "Leave site?" dialog to get stuck on).
// ---------------------------------------------------------------------------
/*
(async () => {
  const ORIGIN = 'https://blackboard.adu.ac.ae';
  const CID = location.pathname.match(/courses\/([^/]+)/)[1];
  const WANT = [
    // 'Chapter-3 whatever.pptx',
  ];

  const api = async (p) => {
    const r = await fetch(ORIGIN + p, {
      credentials: 'same-origin', headers: { Accept: 'application/json' },
    });
    return r.ok ? await r.json() : null;
  };

  // Re-walk to map filename -> permanentUrl (cheap; reuse manifest if still handy).
  const found = {};
  async function walk(id, depth) {
    if (depth > 5) return;
    const kids = await api(`/learn/api/v1/courses/${CID}/contents/${id}/children?limit=200`);
    for (const k of (Array.isArray(kids) ? kids : (kids && kids.results) || [])) {
      const h = k.contentHandler || '';
      if (h.includes('folder') || h.includes('lesson')) { await walk(k.id, depth + 1); continue; }
      const j = await api(`/learn/api/v1/courses/${CID}/contents/${k.id}`);
      const d = j && j.contentDetail && j.contentDetail['resource/x-bb-file'];
      if (d && d.file) found[d.file.fileName] = d.file;
    }
  }
  await walk('ROOT', 0);

  const report = [];
  for (const name of WANT) {
    const f = found[name];
    if (!f) { report.push({ name, ok: false, why: 'not found in course' }); continue; }
    const blob = await (await fetch(ORIGIN + f.permanentUrl, { credentials: 'same-origin' })).blob();
    const ok = blob.size === +f.fileSize;          // verify before writing
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    report.push({ name, ok, bytes: blob.size });
    await new Promise(r => setTimeout(r, 800));    // stagger; Chrome throttles bursts
  }
  return report;
})();
*/
