/* ADU Blackboard Ultra course sync.
 *
 * Paste into the browser console, or into a tool that executes JavaScript inside the
 * signed-in tab. Works for any ADU student and any course you are enrolled in: the
 * origin and the course id are both read from the page, so there is nothing to edit
 * before the first run and nothing goes stale between terms.
 *
 * Prerequisite: a tab open on
 *     https://blackboard.adu.ac.ae/ultra/courses/<id>/outline
 * with you already signed in. This never enters credentials and never touches cookies.
 *
 * THE ONE GOTCHA: the Ultra page carries
 *     <base href="https://dmuwut6e40u5o.cloudfront.net/ultra/uiv...">
 * so every relative URL, including root-relative "/learn/api/...", resolves to
 * CloudFront and comes back as an S3 <Error><Code>NoSuchKey</Code>. That 404 is what
 * earlier notes misread as "CSP blocks fetch()". It is not CSP. Nothing is blocked.
 * Always build absolute URLs against ORIGIN below.
 *
 * API base is the INTERNAL /learn/api/v1, not /learn/api/public/v1 (public needs a
 * developer key students cannot get; internal rides the session cookie).
 *
 * See BLACKBOARD-API.md in this folder for the endpoint reference, the failure modes,
 * and how to brief an AI agent to run this for you. See AGENTS.md for the agent brief.
 *
 * RUN SNIPPET 1, THEN PASTE ITS RESULT INTO SNIPPET 2. Doing that skips a second full
 * walk of the course and is the single biggest saving available here: a typical course
 * goes from roughly 2N+2 requests to N+1.
 */

// ---------------------------------------------------------------------------
// SNIPPET 1 - MANIFEST. Returns every downloadable file in the course.
// Read-only. Run this first and look at what comes back.
//
// Check `complete` in the result before trusting it. If it is false, something was
// not read and the file list is short; `errors` and `warnings` say what and where.
// ---------------------------------------------------------------------------
(async () => {
  const ORIGIN = location.origin;                 // https://blackboard.adu.ac.ae
  const m = location.pathname.match(/courses\/([^/]+)/);
  if (!m) return { error: 'Not on a course page. Open a Blackboard course outline first.' };
  const CID = m[1];

  const PAGE = 200;          // children per request
  const MAX_DEPTH = 8;       // folder nesting; exceeding it is reported, never silent
  const CONCURRENCY = 1;     // requests in flight while resolving files.
                             // 1 matches the long-standing behaviour and is the safe
                             // default. Raising it to 3 or 4 is noticeably faster on a
                             // large course, but bursts are what trigger the Imperva
                             // rate limiting described in BLACKBOARD-API.md section 6.
                             // Raise it only if your runs are slow AND you are not
                             // seeing "TypeError: Failed to fetch" with no status.

  const errors = [], warnings = [], unreadable = [];
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // One retry with a pause, and only ever on failure, so a clean run costs nothing
  // extra. Failures are recorded rather than swallowed: an unread folder must not be
  // indistinguishable from an empty one.
  const api = async (p, attempt = 1) => {
    try {
      const r = await fetch(ORIGIN + p, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      if (r.status === 401) throw new Error('SIGNED_OUT');
      if (!r.ok) {
        if (attempt === 1) { await sleep(1500); return api(p, 2); }
        errors.push({ path: p, status: r.status });
        return null;
      }
      return await r.json();
    } catch (e) {
      if (e.message === 'SIGNED_OUT') throw e;     // stop the run; the student must sign in
      if (attempt === 1) { await sleep(3000); return api(p, 2); }   // probably rate limiting
      errors.push({ path: p, error: String((e && e.message) || e) });
      return null;
    }
  };

  const files = [], folders = [], links = [];

  async function walk(id, path, depth) {
    if (depth > MAX_DEPTH) {
      warnings.push(`Depth cap ${MAX_DEPTH} reached at "${path}". Anything deeper was not read.`);
      unreadable.push(path);
      return;
    }
    let next = `/learn/api/v1/courses/${CID}/contents/${id}/children?limit=${PAGE}`;
    while (next) {
      const kids = await api(next);
      if (kids === null) {                          // failed twice; do not pretend it is empty
        unreadable.push(path || '/');
        return;
      }
      const list = Array.isArray(kids) ? kids : (kids.results || []);
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
      // Follow a cursor only if the response actually gives one. No invented query
      // parameters: an unsupported one 404s and looks like a missing folder.
      const paging = (!Array.isArray(kids) && kids.paging) || null;
      const cursor = paging && (paging.nextPage || paging.next || null);
      if (cursor) {
        next = cursor.startsWith('http') ? cursor.slice(ORIGIN.length) : cursor;
      } else {
        if (list.length === PAGE) {
          warnings.push(`"${path || '/'}" returned a full page of ${PAGE} items and no cursor. There may be more that were not read.`);
          unreadable.push(path || '/');
        }
        next = null;
      }
    }
  }
  await walk('ROOT', '', 0);

  // Resolve each file to its real filename, byte size and permanent URL.
  const out = [];
  const resolve = async (f) => {
    const j = await api(`/learn/api/v1/courses/${CID}/contents/${f.id}`);
    const d = j && j.contentDetail && j.contentDetail['resource/x-bb-file'];
    if (!d || !d.file) {
      if (j === null) unreadable.push(f.path);      // could not read it; not the same as "no file"
      return;
    }
    const folder = f.path.split('/').slice(0, -1).join('/');
    out.push({
      key: folder + '/' + d.file.fileName,          // unique; bare filenames collide across folders
      name: d.file.fileName,
      bytes: +d.file.fileSize,
      url: d.file.permanentUrl,                     // /bbcswebdav/pid-...-rid-..._1/xid-..._1
      folder,
      modified: f.modified ? new Date(f.modified).toISOString().slice(0, 10) : null,
    });
  };

  if (CONCURRENCY <= 1) {
    for (const f of files) await resolve(f);
  } else {
    const queue = files.slice();
    await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
      while (queue.length) await resolve(queue.shift());
    }));
  }

  const complete = errors.length === 0 && unreadable.length === 0;
  return {
    origin: ORIGIN, courseId: CID,
    complete,                                       // false means the list below is short
    folders, files: out, nonFiles: links,
    errors, warnings, unreadable: [...new Set(unreadable)],
    note: complete
      ? 'Complete walk. Paste this whole object into MANIFEST in snippet 2.'
      : 'INCOMPLETE. Something was not read; see errors/unreadable. Re-run before trusting the file list.',
  };
})();

// ---------------------------------------------------------------------------
// SNIPPET 2 - DOWNLOAD.
//
// Paste snippet 1's result into MANIFEST and it skips re-walking the course, which
// is most of the work. Leave MANIFEST null only if you no longer have that result.
//
// Put the files you want in WANT, either as a bare filename or as the manifest's
// "key" (folder + / + filename) when the same name appears in two folders.
//
// A file whose downloaded size does not match the size the server declared is
// REPORTED AND NOT SAVED. A truncated file on disk is worse than a missing one.
// ---------------------------------------------------------------------------
/*
(async () => {
  const ORIGIN = location.origin;
  const CID = location.pathname.match(/courses\/([^/]+)/)[1];

  const MANIFEST = null;     // <- paste snippet 1's whole result object here
  const WANT = [
    // 'Chapter-3 Slides.pptx',
    // '/Week 5/Assignment.pdf',        // use the manifest key when names repeat
  ];

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const api = async (p) => {
    const r = await fetch(ORIGIN + p, {
      credentials: 'same-origin', headers: { Accept: 'application/json' },
    });
    if (r.status === 401) throw new Error('Signed out. Sign in again, then re-run.');
    return r.ok ? await r.json() : null;
  };

  // Index by key (folder + / + filename) and also by bare name, so WANT accepts either.
  const byKey = {}, byName = {}, ambiguous = new Set();
  const add = (f) => {
    byKey[f.key || (f.folder + '/' + f.name)] = f;
    if (byName[f.name]) ambiguous.add(f.name); else byName[f.name] = f;
  };

  if (MANIFEST && MANIFEST.files) {
    if (MANIFEST.complete === false) {
      return { error: 'That manifest is marked incomplete. Re-run snippet 1 first.' };
    }
    MANIFEST.files.forEach(add);
  } else {
    // Fallback: no manifest to hand, so walk the course again.
    async function walk(id, path, depth) {
      if (depth > 8) return;
      const kids = await api(`/learn/api/v1/courses/${CID}/contents/${id}/children?limit=200`);
      for (const k of (Array.isArray(kids) ? kids : (kids && kids.results) || [])) {
        const p = path + '/' + k.title;
        const h = k.contentHandler || '';
        if (h.includes('folder') || h.includes('lesson')) { await walk(k.id, p, depth + 1); continue; }
        const j = await api(`/learn/api/v1/courses/${CID}/contents/${k.id}`);
        const d = j && j.contentDetail && j.contentDetail['resource/x-bb-file'];
        if (d && d.file) {
          const folder = p.split('/').slice(0, -1).join('/');
          add({ key: folder + '/' + d.file.fileName, name: d.file.fileName,
                bytes: +d.file.fileSize, url: d.file.permanentUrl, folder });
        }
      }
    }
    await walk('ROOT', '', 0);
  }

  const report = [];
  for (const want of WANT) {
    const f = byKey[want] || (!ambiguous.has(want) && byName[want]) || null;
    if (!f) {
      report.push({ want, ok: false, why: ambiguous.has(want)
        ? 'name appears in more than one folder; use the manifest key instead'
        : 'not found in course' });
      continue;
    }

    const blob = await (await fetch(ORIGIN + f.url, { credentials: 'same-origin' })).blob();

    if (blob.size !== +f.bytes) {                  // verify BEFORE writing, and mean it
      report.push({ want, ok: false, saved: false,
                    why: `size mismatch: got ${blob.size}, expected ${f.bytes}. Not saved.` });
      await sleep(800);
      continue;
    }

    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = f.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    report.push({ want, ok: true, saved: true, bytes: blob.size, folder: f.folder });
    await sleep(800);                              // stagger; browsers throttle bursts
  }
  return report;
})();
*/
