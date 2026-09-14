# Blackboard Learn Ultra: pulling your own course material out through the internal API

A working reference for downloading the files from courses you are enrolled in, using the
same internal API that the Blackboard Ultra interface itself calls, driven from your own
signed-in browser session.

Everything here is the product of research: reading the Blackboard Learn REST documentation,
watching the requests the Ultra front end actually makes, and testing each endpoint against a
live course until the behaviour was reproducible. Section 1 exists because the first reading
of the evidence was wrong and the research corrected it.

**Who this is for.** Any student or instructor on a Blackboard Learn Ultra deployment who
wants their own course files locally without clicking through the outline one item at a time.
Nothing here is specific to one institution or one course. It was established against one
deployment (see Provenance at the end), and the parts that vary between deployments are
called out where they occur.

**Ground rules, and they are not decoration:**

- Use your own account, on courses you are actually enrolled in. This reads what the
  interface would already show you, faster and more completely. It is not an access bypass
  and must not be used as one.
- Never enter credentials anywhere as part of this. You work from a session you signed into
  yourself, in your own browser. If the session has expired, sign in again yourself.
- Never paste a real `JSESSIONID` or any other session cookie into a document, a chat, an
  issue, or a script. They are live credentials for the duration of the session.
- Check your institution's acceptable use policy. Automated access is usually fine at this
  scale, and one slow pass over your own courses looks like normal browsing. A tight loop
  does not. Rate-limit yourself.

---

## 1. The trap that cost the most time

The Ultra page carries a base tag pointing at a CDN origin:

```html
<base href="https://<hash>.cloudfront.net/ultra/uiv4000.21.0-rel.61_e5a0070">
```

Relative URLs resolve against the **document base**, not the origin. That includes
root-relative ones. So an in-page `fetch('/learn/api/v1/...')` goes to CloudFront, misses
the static bucket, and returns:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Error><Code>NoSuchKey</Code><Message>The specified key does not exist.</Message>
  <Key>learn/api/v1/courses/_00000_1/contents/ROOT</Key></Error>
```

An earlier write-up read that 404 as "content security policy blocks `fetch()`" and
abandoned the API for UI clicking. **Nothing is blocked.** There is no CSP problem.

> **Rule: always build absolute URLs against your Blackboard origin.**
> In page, that is `location.origin`. Never rely on a relative path.

Symptoms that mean you hit this and not something else: status 404, `content-type:
application/xml`, a body containing `NoSuchKey`, and an `x-amz`-style `RequestId`.
A genuine Blackboard 404 returns JSON.

A second, unrelated failure mode looks similar. `TypeError: Failed to fetch` with no status
at all is the edge rate-limiting you after a burst of odd requests. Slow down rather than
varying headers, which is what it looks like you should do and is not.

---

## 2. Does this apply to your deployment?

Three checks, about a minute, before you invest any time.

1. **Are you on Ultra?** Your course URL looks like
   `https://<your-host>/ultra/courses/<courseId>/outline`. If you are on the older Original
   experience, the paths in §4 will not match.
2. **Does the internal API answer you?** Open a course outline, open the browser console,
   and run `await (await fetch(location.origin + '/learn/api/v1/users/me', {credentials:'same-origin'})).json()`.
   A JSON object with an `id` like `_12345_1` means everything in this document should work.
3. **Note your host.** Everything below uses your own origin. There is no shared or central
   endpoint; each institution runs its own.

What varies between deployments: the hostname, the UI build string in the base tag, whether
an edge provider such as Imperva sits in front (affects rate limiting, not the API), and
whether sign-in goes through an institutional single sign-on (affects only how you get a
session, which you do by hand anyway).

What does not vary: the `/learn/api/v1` paths, the `contentHandler` values, and the shape of
`contentDetail`. Those come from the Learn product, not the institution.

---

## 3. Authentication

Session cookie only. `JSESSIONID`, plus whatever cookies the edge provider adds, already
present in the browser you signed in with. Every call below is `credentials: 'same-origin'`
from a page on the Blackboard origin. No token, no XSRF header, no `X-Requested-With` needed.

Consequences worth stating plainly:

- **Never enter credentials.** If the session has expired, stop and sign in yourself.
- This cannot run headless or on a schedule. It needs the signed-in browser.
- Leave the browser cookie store alone. On current Chrome it is app-bound encrypted;
  extracting cookies to drive the download from a shell costs more than it saves and means
  handling a live credential. Run the code in the page instead.

---

## 4. Which API

| | |
|---|---|
| `/learn/api/v1/…` | **Use this.** Internal API the Ultra interface itself calls. Rides the session cookie. |
| `/learn/api/public/v1/…` | Avoid. The documented REST API requires an application registered in the Blackboard developer portal, which a student account cannot do. |

The two are not interchangeable. Paths that exist on one may 404 on the other; see §6.

---

## 5. Endpoints

`<courseId>` below is the Blackboard course id, in the form `_91180_1`. It is visible in the
outline URL, so the script reads it from `location.pathname` rather than asking you for it.

### Identity and enrolment

```
GET /learn/api/v1/users/me
    → { id: "_12345_1", … }

GET /learn/api/v1/users/<userId>/memberships?expand=course&limit=100
    → [ { course: { id, name, courseId }, role, isAvailable, … }, … ]
```

The memberships call returns every term the account has ever been enrolled in, which can be
dozens of entries, so filter by the term suffix in `course.name`, for example `2026-2027 FALL`.
`course.id` is the Blackboard id used everywhere else. `course.courseId` is the registry
code, which is usually what appears in notification emails.

**This is how you get your own course ids.** There is no need to hardcode a list, and a
hardcoded list goes stale every term.

### Content tree

```
GET /learn/api/v1/courses/<courseId>/contents/ROOT
GET /learn/api/v1/courses/<courseId>/contents/<contentId>/children?limit=200
GET /learn/api/v1/courses/<courseId>/contents/<contentId>
```

Walk recursively from `ROOT`. Branch on `contentHandler`:

| `contentHandler` | Meaning |
|---|---|
| `resource/x-bb-folder` | Folder. Recurse into its children. |
| `resource/x-bb-lesson` | Learning module. Recurse the same way. |
| `resource/x-bb-file` | A downloadable file. |
| `resource/x-bb-document` | Content item that may carry an attachment. |
| `resource/x-bb-blti-link` | External tool launch, typically an e-textbook. Not downloadable. |

The tree walk sees everything the interface would eventually show you, including files inside
folders that stay collapsed and files past the tenth item that the interface hides behind its
"Load N more content items" button. This is the main reason the API beats clicking on
correctness, not just speed.

Do **not** add `?expand=allTitles&recursive=true`. It 404s.

### Resolving a file

The single-item call carries the download metadata:

```
GET /learn/api/v1/courses/<courseId>/contents/<contentId>
```

```jsonc
"contentDetail": {
  "resource/x-bb-file": {
    "fileAssociationMode": "EMBED",
    "file": {
      "fileName":     "Chapter-2 Slides.pptx",
      "fileSize":     "4216487",           // string, coerce to number
      "mimeType":     "application/vnd.openxmlformats-…-presentation",
      "permanentUrl": "/bbcswebdav/pid-0000000-dt-content-rid-00000000_1/xid-00000000_1",
      "xid":          "xid-00000000_1",
      "forceDownload": "false",
      "isMedia":      "false"
    }
  }
}
```

`body.webLocation` and `body.fileLocation` also appear on the item. Ignore them;
`fileLocation` is an opaque encoded token and `webLocation` points at an embed wrapper.

**There is no `/attachments` sub-resource on the internal API.** It returns 404 for every
content id. That endpoint belongs to the public API. Read `contentDetail` instead.

### Downloading

```
GET <your origin><permanentUrl>
```

Returns the raw bytes with the correct `content-type`. Verified with a `Range: bytes=0-63`
probe returning `206 Partial Content` and the `PK\x03\x04` ZIP signature, and a full fetch
whose blob size matched the declared `fileSize` exactly, byte for byte.

Range requests are supported, so you can confirm a file is what it claims before pulling
several megabytes.

### Observed but not individually exercised

Seen in the interface's own traffic, listed for orientation: `…/entitlements`, `…/tools`,
`…/tools/announcements`, `…/tools/groups`, `…/schedule?sort=location(desc)`, `…/spreview`,
`/learn/api/v1/terms`, `/learn/api/v1/utilities/entitlements`.

---

## 6. Failure modes and what they actually mean

| Symptom | Cause | Fix |
|---|---|---|
| 404, XML body, `NoSuchKey` | Relative URL resolved against the `<base>` CDN origin | Use an absolute URL built from `location.origin` |
| 404, JSON body | Endpoint genuinely absent, e.g. `/attachments` on the internal API | Read `contentDetail` |
| `TypeError: Failed to fetch`, no status | Edge rate limiting after a burst | Pause; do not vary headers |
| 401 or a redirect to the sign-in page | Session expired | Sign in yourself in the browser, then re-run. Never script the sign-in |
| Only the first download lands | The browser silently blocks repeated automatic downloads from one origin, and its "allow multiple downloads" prompt cannot be clicked by an extension | Stagger saves and verify each; else use the presigned fallback below |
| Tab stuck on "Leave site?" | A file viewer page registers an unsaved-changes handler that even a forced navigation will not dismiss | Never open viewer pages. Open a fresh tab and leave the stuck one |

### Presigned-link fallback

When a download will not land at all, open

```
<your origin>/webapps/blackboard/execute/content/file?cmd=view&content_id=<contentId>&course_id=<courseId>
```

That tab freezes, but it spawns a second tab at an Office web viewer whose `src` query
parameter is a presigned S3 link to the file. Read that URL, URL-decode `src` once, and fetch
it directly into the destination folder. The link needs no auth and lasts about six hours.
Close the frozen tab.

---

## 7. Driving this with an AI agent

This is the part people usually get wrong, so it is worth being precise.

**You do not train a model to do this.** No fine-tuning, no dataset, no custom model. Any
current assistant can already walk a JSON tree and write a `fetch` loop. What it cannot do is
guess your host, your session, or the `<base href>` trap. So this is a **context** problem,
and the fix is to hand the agent this document plus the right tools.

**What the agent actually needs:**

1. A tool that runs JavaScript **inside your already signed-in browser tab**. A browser
   automation extension that exposes a JS-execution tool is the usual route. A headless
   browser will not work, because it has no session.
2. This document, or at least §1, §3 and §5, in its context.
3. Permission from you to save files to a folder you name.

**Briefing to copy and paste**, adjusting the folder:

```text
I am signed in to my university's Blackboard Ultra in the browser, on a course outline page.
Use the attached BLACKBOARD-API.md as the reference. Your job is to list every downloadable
file in this course and save the ones I do not already have into <folder>.

Hard rules:
- Build every URL absolutely from location.origin. Relative URLs hit the CDN base and return
  an XML NoSuchKey error. That is not CSP and not a permissions problem.
- Use /learn/api/v1, never /learn/api/public/v1.
- Never enter credentials and never touch the cookie store. If you get a 401 or a sign-in
  redirect, stop and tell me to sign in.
- If you get "TypeError: Failed to fetch" with no status, you are being rate limited. Wait,
  then resume slowly. Do not vary headers to get around it.
- Verify each download by comparing the blob size to the declared fileSize before counting it
  as saved. Report anything that does not match.
- Show me the manifest and wait for my confirmation before downloading anything.
```

That last line matters more than it looks. The manifest step is cheap, reversible and easy to
eyeball; the download step writes to your disk. Keep a human decision between them.

**Making it repeatable.** If your assistant supports saved instructions (a skill, a custom
instruction file, a project prompt), put the briefing there rather than retyping it. That is
the real meaning of "training your AI to do this": you are encoding a procedure in context,
not changing any model weights. It is inspectable, editable in one place, and you can hand
the same file to someone else and have it work for them too.

**What to expect.** One course, one pass, is roughly four tool calls: walk the tree, resolve
the files, compare against the local folder, download the gaps. The clicking equivalent runs
to about thirty and misses the collapsed and hidden items.

---

## 8. Prior art, and when not to use this

This is not novel work. Blackboard publishes an official REST API at
`developer.blackboard.com`, documented under the same version line as the deployment this was
established against (`4000.21.0`), so the official reference likely describes most of §5.
Registration requires an application key a student account cannot obtain, which is the only
reason the internal API was used instead. Community downloaders are a long-standing genre.

**Check `sanjacob/BlackboardSync` first.** It is a maintained cross-platform desktop app doing
periodic incremental downloads, and it beats this workflow at pure syncing while costing
nothing per run. It supports roughly sixty universities. **If yours is on its list, use it and
ignore this document.** This is for the institutions it does not cover, which at time of
writing includes every UAE institution. Adding one means filing a request with the maintainer
plus gathering campus network data on site.

Unverified, and worth answering before attempting that route: whether it authenticates by
browser session or by an institution-enabled key, and whether an institutional single sign-on
plus an Imperva-style edge would work with it at all.

---

## 9. Files here

| Path | Role |
|---|---|
| `BLACKBOARD-API.md` | This document. The source of truth for API behaviour. |
| `bb-sync.js` | Working script: a manifest snippet and a download snippet, both paste-ready. |

If the two ever disagree, `bb-sync.js` is the source of truth for the code and this document
for the API behaviour.

---

## Provenance

Established 14 September 2026 against a Blackboard Learn Ultra SaaS deployment behind an
Imperva edge, UI build `uiv4000.21.0-rel.61`, testing against a live enrolled course. Course
ids, user ids and host names have been kept out of this document deliberately: yours will
differ, and §5 shows you how to look up your own.

## Changelog

**2026-09-14, second version.** Generalised from one institution's deployment to any Learn
Ultra deployment. Removed the hardcoded host, the captured user id and the term's course id
table, replacing them with the memberships lookup in §5. Added §2 for checking whether your
deployment matches, §7 on briefing an AI agent, explicit ground rules on acceptable use, and
a 401 row to the failure table. Reframed §8 so readers whose institution is supported by
BlackboardSync are sent there instead.

**2026-09-14, first version.** Replaced the UI-clicking method. Corrected the CSP
misdiagnosis to the `<base href>` resolution bug. Documented the content tree, file
resolution and direct download. Measured cost fell from roughly thirty tool calls per course
to about four.
