# Blackboard Ultra at ADU: pulling your own course material out through the internal API

A working reference for ADU students downloading the files from courses they are enrolled in,
using the same internal API that the Blackboard Ultra interface itself calls, driven from
your own signed-in browser session.

Everything here is the product of research: reading the Blackboard Learn REST documentation,
watching the requests the Ultra front end actually makes, and testing each endpoint against a
live course until the behaviour was reproducible. Section 1 exists because the first reading
of the evidence was wrong and the research corrected it.

- **Host:** `https://blackboard.adu.ac.ae`
- **Deployment:** Blackboard Learn Ultra, SaaS, behind Imperva. UI build observed `uiv4000.21.0-rel.61`
- **Established:** 14 September 2026, tested against a live enrolled course
- **Companion script:** `bb-sync.js`, in this folder

**Who this is for.** Any ADU student on `blackboard.adu.ac.ae` who wants their own course
files locally without clicking through the outline one item at a time. It is written for ADU
specifically: the host, the edge provider and the sign-on are ours, and ADU does not offer a
supported API route for this, which is why the internal one is documented here.

Nothing in it is tied to a particular student or a particular term. Your user id and your
course ids are looked up in §5, not hardcoded, so this works for any ADU course you are
enrolled in and keeps working next semester.

Other universities run Learn Ultra too and the `/learn/api/v1` behaviour is a product
behaviour rather than an ADU one, so most of this would probably transfer. None of it has
been tested anywhere but ADU, so treat that as untested if you try it.

**Ground rules, and they are not decoration:**

- Use your own ADU account, on courses you are actually enrolled in. This reads what the
  interface would already show you, faster and more completely. It is not an access bypass
  and must not be used as one.
- Never enter credentials anywhere as part of this. You work from a session you signed into
  yourself, through ADU's normal sign-on, in your own browser. If the session has expired,
  sign in again yourself.
- Never paste a real `JSESSIONID` or `incap_ses_*` cookie into a document, a chat, an issue,
  or a script. They are live credentials for the duration of the session.
- Stay inside ADU's acceptable use policy. One slow pass over your own courses looks like
  normal browsing. A tight loop does not. Rate-limit yourself.

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
  <Key>learn/api/v1/courses/_00000_1/contents/ROOT</Key></Error>
```

An earlier write-up read that 404 as "content security policy blocks `fetch()`" and
abandoned the API for UI clicking. **Nothing is blocked.** There is no CSP problem.

> **Rule: always build absolute URLs against `https://blackboard.adu.ac.ae`.**
> In page, `location.origin` gives you exactly that. Never rely on a relative path.

Symptoms that mean you hit this and not something else: status 404, `content-type:
application/xml`, a body containing `NoSuchKey`, and an `x-amz`-style `RequestId`.
A genuine Blackboard 404 returns JSON.

A second, unrelated failure mode looks similar. `TypeError: Failed to fetch` with no status
at all is the Imperva edge rate-limiting you after a burst of odd requests. Slow down rather
than varying headers, which is what it looks like you should do and is not.

---

## 2. Before you start

Two checks, about a minute.

1. **Are you on Ultra?** Your course URL looks like
   `https://blackboard.adu.ac.ae/ultra/courses/<courseId>/outline`. Everything below assumes
   the Ultra experience.
2. **Does the API answer you?** Open a course outline, open the browser console, and run
   `await (await fetch(location.origin + '/learn/api/v1/users/me', {credentials:'same-origin'})).json()`.
   A JSON object with an `id` like `_12345_1` means your session is good and the rest of this
   document will work. A sign-in redirect means sign in first.

Then find your own course ids with the memberships call in §5. Do not copy anyone else's;
they change every term and they are per-account.

---

## 3. Authentication

Session cookie only. `JSESSIONID` plus the Imperva `incap_ses_*` pair, already present in
the browser you signed in with. Every call below is `credentials: 'same-origin'` from a page
on the Blackboard origin. No token, no XSRF header, no `X-Requested-With` needed.

Consequences worth stating plainly:

- **Never enter credentials.** If the session has expired, stop and sign in yourself through
  ADU's normal sign-on.
- This cannot run headless or on a schedule. It needs the signed-in browser.
- Leave the browser cookie store alone. On current Chrome it is app-bound encrypted;
  extracting cookies to drive the download from PowerShell costs more than it saves and means
  handling a live credential. Run the code in the page instead.

---

## 4. Which API

| | |
|---|---|
| `/learn/api/v1/…` | **Use this.** Internal API the Ultra interface itself calls. Rides the session cookie. |
| `/learn/api/public/v1/…` | Avoid. The documented REST API requires an application registered in the Blackboard developer portal, which an ADU student account cannot do. |

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

The memberships call returns every term the account has ever been enrolled in, which runs to
dozens of entries for a senior, so filter by the term suffix in `course.name`, for example
`2026-2027 FALL`. `course.id` is the Blackboard id used everywhere else. `course.courseId` is
the registry code such as `26011144`, which is what appears in ADU notification emails.

**This is how you get your own course ids.** A hardcoded list goes stale every term and is
wrong for every other student, so look yours up here.

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
assessment folders that stay invisible while the outline is collapsed, and files past the
tenth item that the interface hides behind its "Load N more content items" button. This is
the main reason the API beats clicking on correctness, not just speed.

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
GET https://blackboard.adu.ac.ae<permanentUrl>
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
| 404, XML body, `NoSuchKey` | Relative URL resolved against the `<base>` CloudFront origin | Use an absolute URL built from `location.origin` |
| 404, JSON body | Endpoint genuinely absent, e.g. `/attachments` on the internal API | Read `contentDetail` |
| `TypeError: Failed to fetch`, no status | Imperva rate limiting after a burst | Pause; do not vary headers |
| 401 or a redirect to the ADU sign-in page | Session expired | Sign in yourself in the browser, then re-run. Never script the sign-in |
| Only the first download lands | Chrome silently blocks repeated automatic downloads from one origin, and its "allow multiple downloads" prompt cannot be clicked by an extension | Stagger saves and verify each; else use the presigned fallback below |
| Tab stuck on "Leave site?" | A file viewer page registers an unsaved-changes handler that even a forced navigation will not dismiss | Never open viewer pages. Open a fresh tab and leave the stuck one |

### Presigned-link fallback

When a download will not land at all, open

```
https://blackboard.adu.ac.ae/webapps/blackboard/execute/content/file?cmd=view&content_id=<contentId>&course_id=<courseId>
```

That tab freezes, but it spawns a second tab at `view.officeapps.live.com` whose `src` query
parameter is a presigned S3 link to the file. Read that URL, URL-decode `src` once, and fetch
it directly into the destination folder. The link needs no auth and lasts about six hours.
Close the frozen tab.

---

## 7. Driving this with an AI agent

This is the part people usually get wrong, so it is worth being precise.

**You do not train a model to do this.** No fine-tuning, no dataset, no custom model. Any
current assistant can already walk a JSON tree and write a `fetch` loop. What it cannot do is
guess ADU's host, your session, or the `<base href>` trap, and left to itself it will
rediscover that trap and misdiagnose it as a permissions problem exactly as the first attempt
did. So this is a **context** problem, and the fix is to hand the agent this document plus
the right tools.

**What the agent actually needs:**

1. A tool that runs JavaScript **inside your already signed-in browser tab**. A browser
   automation extension that exposes a JS-execution tool is the usual route. A headless
   browser will not work, because it has no ADU session.
2. This document, or at least §1, §3 and §5, in its context.
3. Permission from you to save files to a folder you name.

**Briefing to copy and paste**, adjusting the folder:

```text
I am signed in to ADU Blackboard (https://blackboard.adu.ac.ae) in the browser, on a course
outline page. Use the attached BLACKBOARD-API.md as the reference. Your job is to list every
downloadable file in this course and save the ones I do not already have into <folder>.

Hard rules:
- Build every URL absolutely from location.origin. Relative URLs hit the CloudFront base and
  return an XML NoSuchKey error. That is not CSP and not a permissions problem.
- Use /learn/api/v1, never /learn/api/public/v1.
- Never enter credentials and never touch the cookie store. If you get a 401 or a sign-in
  redirect, stop and tell me to sign in.
- If you get "TypeError: Failed to fetch" with no status, Imperva is rate limiting you. Wait,
  then resume slowly. Do not vary headers to get around it.
- Verify each download by comparing the blob size to the declared fileSize before counting it
  as saved. Report anything that does not match.
- Show me the manifest and wait for my confirmation before downloading anything.
```

That last line matters more than it looks. The manifest step is cheap, reversible and easy to
eyeball; the download step writes to your disk. Keep a human decision between them.

**Making it repeatable.** If your assistant supports saved instructions (a skill, a custom
instruction file, a project prompt), put the briefing there rather than retyping it every
term. That is the real meaning of "training your AI to do this": you are encoding a procedure
in context, not changing any model weights. It is inspectable, editable in one place, and you
can hand the same file to another ADU student and have it work for them.

**What to expect.** One course, one pass, is roughly four tool calls: walk the tree, resolve
the files, compare against the local folder, download the gaps. The clicking equivalent runs
to about thirty and misses the collapsed and hidden items.

---

## 8. Prior art, and why this exists

This is not novel work. Blackboard publishes an official REST API at
`developer.blackboard.com`, documented under the same version line as ADU's deployment
(`4000.21.0`), so the official reference likely describes most of §5. Registration requires
an application key a student account cannot obtain, which is the only reason the internal API
was used instead. Community downloaders are a long-standing genre.

**BlackboardSync** (`sanjacob/BlackboardSync`) is the closest existing tool: a maintained
cross-platform desktop app doing periodic incremental downloads. It beats this workflow at
pure syncing and costs nothing per run. It supports about sixty universities; **Abu Dhabi
University is not among them and no UAE institution is.** That is the gap this document
fills. Adding ADU means filing a request with the maintainer plus gathering campus network
data on site.

**Decision, 14 September 2026: not pursuing that.** Recorded here so the option is not
rediscovered and re-evaluated from scratch later.

Also unverified, and worth answering before any such attempt: whether it authenticates by
browser session or by an institution-enabled key, and whether ADU's Microsoft single sign-on
and the Imperva edge would work with it at all.

---

## 9. Files here

| Path | Role |
|---|---|
| `BLACKBOARD-API.md` | This document. The source of truth for API behaviour. |
| `bb-sync.js` | Working script: a manifest snippet and a download snippet, both paste-ready. |

If the two ever disagree, `bb-sync.js` is the source of truth for the code and this document
for the API behaviour.

---

## Changelog

**2026-09-14, second version.** Opened up from one student's setup to any ADU student. The
captured user id and the term's course id table are gone, replaced by the memberships lookup
in §5 that finds your own; the script now reads the origin and course id from the page
instead of carrying them. Added §2 as a pre-flight check, §7 on briefing an AI agent,
explicit ground rules on using your own account and never handling credentials or cookies,
and a 401 row in the failure table. Still ADU-specific by design: the host, the Imperva edge
and the sign-on are ours, and §8 explains why no existing tool covers us.

**2026-09-14, first version.** Replaced the UI-clicking method. Corrected the CSP
misdiagnosis to the `<base href>` resolution bug. Documented the content tree, file
resolution and direct download. Measured cost fell from roughly thirty tool calls per course
to about four.
