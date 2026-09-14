# Blackboard Ultra — API reference

Canonical working document for pulling course material out of ADU Blackboard.
Anything else that describes this process defers to this file.

- **Host:** `https://blackboard.adu.ac.ae`
- **Deployment:** Blackboard Learn Ultra, SaaS, behind Imperva. UI build observed `uiv4000.21.0-rel.61`
- **Established:** 14 September 2026, against ITE 414 Introduction to E-Commerce
- **Companion script:** `bb-sync.js`, in this folder

---

## 1. The trap that cost the most time

The Ultra page carries a base tag pointing at a CloudFront origin:

```html
<base href="https://dmuwut6e40u5o.cloudfront.net/ultra/uiv4000.21.0-rel.61_e5a0070">
```

Relative URLs resolve against the **document base**, not the origin. That includes
root-relative ones. So an in-page `fetch('/learn/api/v1/...')` goes to CloudFront, misses
the static bucket, and returns:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Error><Code>NoSuchKey</Code><Message>The specified key does not exist.</Message>
  <Key>learn/api/v1/courses/_91180_1/contents/ROOT</Key></Error>
```

An earlier write-up read that 404 as "content security policy blocks `fetch()`" and
abandoned the API for UI clicking. **Nothing is blocked.** There is no CSP problem.

> **Rule: always build absolute URLs against `https://blackboard.adu.ac.ae`.**

Symptoms that mean you hit this and not something else: status 404, `content-type:
application/xml`, a body containing `NoSuchKey`, and an `x-amz`-style `RequestId`.
A genuine Blackboard 404 returns JSON.

A second, unrelated failure mode looks similar. `TypeError: Failed to fetch` with no status
at all is the edge rate-limiting you after a burst of odd requests. Slow down rather than
varying headers, which is what it looks like you should do and is not.

---

## 2. Authentication

Session cookie only. `JSESSIONID` plus the Imperva `incap_ses_*` pair, already present in
the user's Chrome. Every call below is `credentials: 'same-origin'` from a page on the
Blackboard origin. No token, no XSRF header, no `X-Requested-With` needed.

Consequences worth stating plainly:

- **Never enter credentials.** If the session has expired, stop and ask the user to sign in.
- This cannot run headless or on a schedule. It needs the signed-in browser.
- Leave Chrome's cookie store alone. It is app-bound encrypted; extracting cookies to drive
  the download from PowerShell costs more than it saves and handles a live credential.

---

## 3. Which API

| | |
|---|---|
| `/learn/api/v1/…` | **Use this.** Internal API the Ultra interface itself calls. Rides the session cookie. |
| `/learn/api/public/v1/…` | Avoid. The documented REST API requires an application registered in the Blackboard developer portal, which a student account cannot do. |

The two are not interchangeable. Paths that exist on one may 404 on the other; see §5.

---

## 4. Endpoints

Verified against ITE 414 on 14 September 2026 unless marked otherwise.

### Identity and enrolment

```
GET /learn/api/v1/users/me
    → { id: "_68842_1", … }

GET /learn/api/v1/users/<userId>/memberships?expand=course&limit=100
    → [ { course: { id, name, courseId }, role, isAvailable, … }, … ]
```

The memberships call returned 73 entries covering every term the account has ever been
enrolled in, so filter by the term suffix in `course.name`, for example `2026-2027 FALL`.
`course.id` is the Blackboard id used everywhere else. `course.courseId` is the registry
code such as `26011144`, which is what appears in notification emails.

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

The tree walk sees everything, including files inside assessment folders that stay invisible
while the outline is collapsed, and files past the tenth item that the interface hides behind
its "Load N more content items" button. This is the main reason the API beats clicking on
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
      "fileName":     "2- Chapter-2- E-Commerce Business Models & Concepts.pptx",
      "fileSize":     "4216487",           // string, coerce to number
      "mimeType":     "application/vnd.openxmlformats-…-presentation",
      "permanentUrl": "/bbcswebdav/pid-2085741-dt-content-rid-42992411_1/xid-42992411_1",
      "xid":          "xid-42992411_1",
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
GET https://blackboard.adu.ac.ae<permanentUrl>
```

Returns the raw bytes with the correct `content-type`. Verified: `206 Partial Content` on a
`Range: bytes=0-63` probe returning the `PK\x03\x04` ZIP signature, and a full fetch whose
blob size matched the declared `fileSize` exactly, byte for byte.

Range requests are supported, so you can confirm a file is what it claims before pulling
several megabytes.

### Observed but not individually exercised

Seen in the interface's own traffic, listed for orientation: `…/entitlements`, `…/tools`,
`…/tools/announcements`, `…/tools/groups`, `…/schedule?sort=location(desc)`, `…/spreview`,
`/learn/api/v1/terms`, `/learn/api/v1/utilities/entitlements`.

---

## 5. Failure modes and what they actually mean

| Symptom | Cause | Fix |
|---|---|---|
| 404, XML body, `NoSuchKey` | Relative URL resolved against the `<base>` CloudFront origin | Use an absolute URL |
| 404, JSON body | Endpoint genuinely absent, e.g. `/attachments` on the internal API | Read `contentDetail` |
| `TypeError: Failed to fetch`, no status | Edge rate limiting after a burst | Pause; do not vary headers |
| Only the first download lands | Chrome silently blocks repeated automatic downloads from one origin, and its "allow multiple downloads" prompt cannot be clicked by the extension | Stagger saves and verify each; else use the presigned fallback below |
| Tab stuck on "Leave site?" | A file viewer page registers an unsaved-changes handler; even `force: true` will not dismiss it | Never open viewer pages. Open a fresh tab and leave the stuck one |

### Presigned-link fallback

When a download will not land at all, open

```
https://blackboard.adu.ac.ae/webapps/blackboard/execute/content/file?cmd=view&content_id=<contentId>&course_id=<courseId>
```

That tab freezes, but it spawns a second tab at `view.officeapps.live.com` whose `src` query
parameter is a presigned S3 link to the file. Read the URL from `tabs_context_mcp`,
URL-decode `src` once, and fetch it with `Invoke-WebRequest -OutFile` directly into the
destination folder. The link needs no auth and lasts about six hours. Close the frozen tab.

---

## 6. Current course ids

Fall 2026-27, captured 14 September 2026. User id `_68842_1`.

| Local folder | Course | Id |
|---|---|---|
| ITE401 | IT Project Management | `_91040_1` |
| ITE408 | Information Security | `_91467_1` |
| ITE409 | Human Computer Interaction | `_90849_1` |
| ITE414 | Introduction to E-Commerce | `_91180_1` |
| ITE442 | Data Science and Big Data Analytics | `_91825_1` |

Refresh with the memberships call in §4.

---

## 7. Prior art

This is not novel work. Blackboard publishes an official REST API at
`developer.blackboard.com`, documented under the same version line as this deployment
(`4000.21.0`), so the official reference likely describes most of §4. Registration requires
an application key a student account cannot obtain, which is the only reason the internal
API was used instead. Community downloaders are a long-standing genre.

**BlackboardSync** (`sanjacob/BlackboardSync`) is the closest existing tool: a maintained
cross-platform desktop app doing periodic incremental downloads. It beats this workflow at
pure syncing and costs nothing per run. It supports about sixty universities; **Abu Dhabi
University is not among them and no UAE institution is.** Adding one means filing a request
with the maintainer plus gathering campus network data on site.

**Decision, 14 September 2026: not pursuing it. We use ours.** Recorded here only so the
option is not rediscovered and re-evaluated from scratch later.

Also unverified, and would need answering before any such attempt: whether it authenticates
by browser session or by an institution-enabled key, and whether ADU's Microsoft single
sign-on and Imperva edge would work with it at all.

## 8. Related files

| Path | Role |
|---|---|
| `G:\APIs\Blackboard\bb-sync.js` | Working script. Manifest and download snippets. |
| `Documents\COURSE-UPDATE-PLAYBOOK.md` | Self-contained routine a course chat follows. Defers to this file on API detail. |
| `C:\Users\User\.claude\scripts\office_text.py` | Reads `.pptx`, `.docx`, `.xlsx` with the standard library. Run with `PYTHONIOENCODING=utf-8`. |

**Drift warning.** The playbook inlines copies of both snippets from `bb-sync.js` so a course
chat needs only one file. Change the logic in one place and you must change it in the other.
If they ever disagree, `bb-sync.js` is the source of truth for the code, this document for
the API behaviour.

---

## Changelog

**2026-09-14** — First version. Replaced the UI-clicking method. Corrected the CSP
misdiagnosis to the `<base href>` resolution bug. Documented the content tree, file
resolution, and direct download. Captured all five current course ids. Measured cost fell
from roughly thirty tool calls per course to about four.
