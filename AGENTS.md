# Brief for an AI agent

You are reading this because a student gave you a link to this repository and asked you to
get their course files out of ADU Blackboard. This file tells you what they actually want and
how to do it without wasting their time. Read it fully before your first tool call.

`BLACKBOARD-API.md`, beside this file, is the detailed reference: endpoints, response shapes,
failure modes. Read it too. This file is the intent; that one is the mechanics.

---

## 1. The intent

A student is enrolled in several courses on `https://blackboard.adu.ac.ae`. Their course
material sits in the Blackboard Ultra interface, which is slow to click through and, worse,
**incomplete on first sight**: it collapses assessment folders and hides items past the tenth
behind a "Load N more content items" button. A student clicking through in good faith will
miss files and not know it.

What they want is a **complete, verified local copy of one course's files, kept current across
the term.** Three words carry weight there:

- **Complete.** Every downloadable item in the course tree, including the ones the interface
  is hiding right now. This is the main reason to use the API at all. Getting it merely fast
  but still incomplete is a failure.
- **Verified.** Each file confirmed to be the size the server said it was, before you report
  it as saved. A truncated `.pptx` that looks fine in a file listing is worse than a missing
  one, because they will not find out until they open it the night before an exam.
- **Current.** They will run this again in three weeks. Download what is missing, leave what
  is already there alone, and tell them clearly what changed.

You are not building a general scraper and you are not exploring. You are doing one course,
once, correctly.

## 2. Who you are working for, and what that constrains

The student is signed in to their own ADU account, in their own browser, on a course they are
enrolled in. You are reading what the interface would already show them, faster and more
completely.

That is the entire basis on which this is legitimate, so do not step outside it:

- **Never enter credentials.** Not into a login form, not anywhere. If you hit a 401 or get
  redirected to sign-in, stop and ask the student to sign in themselves. Then continue.
- **Never read, extract, copy or print session cookies.** Not `JSESSIONID`, not the
  `incap_ses_*` pair, not into a variable you echo back. They are live credentials. You do not
  need them: you run inside the signed-in page and the browser attaches them for you.
- **Only courses they are enrolled in.** Do not guess, enumerate or increment course ids. Get
  the list from the memberships call, which returns exactly what their account is entitled to.
- **Rate-limit yourself.** One course per run, and pace the requests. See §5.
- **Do not download anything to a location the student did not name.**

If the student asks you to do something outside these lines, say no and explain why in one
sentence. The method depends on staying ordinary.

## 3. What you need before you start

1. **A tool that runs JavaScript inside the student's signed-in browser tab.** Usually a
   browser-automation extension exposing a JS execution tool. A headless browser is useless
   here: it has no ADU session.
2. **The tab open on the course outline**, at
   `https://blackboard.adu.ac.ae/ultra/courses/<courseId>/outline`.
3. **A destination folder, named by the student.** One folder per course is the intended
   setup. If they have not said which folder, ask before downloading anything.

If any of the three is missing, ask for it rather than improvising around it.

## 4. The three traps, stated before you hit them

These are not hypothetical. Each one cost real time before it was understood, and you will
meet at least the first.

**The `<base href>` trap.** The Ultra page carries a base tag pointing at a CloudFront origin,
so *every* relative URL, including root-relative ones like `/learn/api/v1/...`, resolves to
CloudFront instead of Blackboard and returns a 404 with an XML body containing `NoSuchKey`.

> Build every URL absolutely from `location.origin`. Always.

If you see that 404, you have made this mistake. **It is not a content security policy
problem, not a permissions problem, and not a sign that the API is unavailable.** A previous
attempt concluded exactly that and abandoned the API for clicking through the UI, which is the
mistake this whole repository exists to prevent you from repeating. A genuine Blackboard 404
returns JSON, not XML.

**The wrong API.** Use `/learn/api/v1`. Do not use `/learn/api/public/v1`: it needs a
developer application key that a student account cannot obtain. Paths that exist on one 404 on
the other. In particular there is no `/attachments` sub-resource on the internal API; the
download metadata lives in `contentDetail`.

**Rate limiting that does not look like rate limiting.** `TypeError: Failed to fetch` with no
status code at all is the Imperva edge throttling you after a burst. Slow down and resume. Do
**not** start varying headers, adding `X-Requested-With`, or rotating anything to get around
it. That is what it looks like you should do, it does not work, and it makes the traffic look
like exactly what it is not.

## 5. The procedure

**Step 1: confirm the session.** Run the `/learn/api/v1/users/me` check from §2 of
`BLACKBOARD-API.md`. JSON with an `id` means you are good. A redirect means ask them to sign
in.

**Step 2: build the manifest.** Use snippet 1 of `bb-sync.js`. It walks the content tree from
`ROOT`, recursing into folders and lessons, and resolves each file to its real filename, byte
size and permanent URL. It reads the origin and course id off the page, so there is nothing to
edit.

**Step 3: compare against the folder.** List what is already in the destination folder and
work out what is genuinely missing. Match on filename. Do not re-download what is there.

**Step 4: show the student the manifest and wait.** Tell them what the course contains, what
they already have, and what you propose to download. **Then stop and wait for confirmation.**

This is not a formality. Steps 1 to 3 are read-only and reversible; step 5 writes to their
disk. Keep a human decision between the two halves. Never skip straight to downloading because
the answer seems obvious.

**Step 5: download, verify, report.** Use snippet 2. For each file compare the received blob
size against the declared `fileSize` and only count it as saved when they match. Stagger the
saves; the browser silently blocks rapid repeated downloads from one origin. If a file will
not land at all, use the presigned-link fallback in §6 of `BLACKBOARD-API.md`.

Report at the end: what was saved, what was skipped because it was already present, and
anything that failed with the reason. If a size check failed, say so plainly and do not
describe that file as downloaded.

## 6. Things that will go wrong, and what they mean

The full table is §6 of `BLACKBOARD-API.md`. The four you are most likely to meet:

| What you see | What it is | What to do |
|---|---|---|
| 404, XML, `NoSuchKey` | The `<base href>` trap | Use absolute URLs from `location.origin` |
| `TypeError: Failed to fetch`, no status | Imperva rate limiting | Pause, resume slower, change nothing else |
| 401 or sign-in redirect | Session expired | Ask the student to sign in, then continue |
| Tab stuck on "Leave site?" | You opened a file viewer page | Never open viewer pages. Open a fresh tab, abandon the stuck one |

## 7. How you fit into their setup

The intended arrangement is **one folder and one chat per course**. You are probably one of
several conversations, each responsible for a single course.

So: stay in your lane. Handle the course you were given. Do not wander into their other
courses to be helpful, and do not try to do all five in one run, which is precisely the burst
that gets you rate limited.

Remember across the term what you downloaded, so the next catch-up is a short diff rather
than a fresh explanation. And defer to `BLACKBOARD-API.md` on anything about API behaviour
rather than re-deriving it. If you find something there that is wrong or out of date, say so
explicitly so it can be fixed at the source instead of being worked around in five separate
chats.

## 8. Done looks like

- Every downloadable file in the course accounted for, including the ones the interface hides.
- Missing files saved into the folder they named, each one size-verified.
- Files already present left untouched.
- A short report of saved, skipped and failed, with reasons.
- No credentials entered, no cookies touched, no other course affected.
