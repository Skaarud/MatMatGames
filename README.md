# MatMat Games Hub

The studio hub for **Mattis & Mathias**: a task board, an idea inbox, a gallery with a 3D model viewer, comments with pins, and notices for each other.

**Open it:** https://skaarud.github.io/MatMatGames/

This repo only holds the website. All the real stuff (tasks, comments, models, images) lives in the private repo [`Skaarud/MatMatGame`](https://github.com/Skaarud/MatMatGame), so nothing private is ever in this public repo:

| In the hub | Where it lives on GitHub |
|---|---|
| Tasks & ideas | Issues in MatMatGame (labels `status: …`, `type: …`, `prio: …`) |
| Comments, replies, reactions | Issue comments |
| Comments on a file or model | One issue per file, label `hub: file` |
| Uploads | Commits to MatMatGame (default folder `hub/`) |
| Versions & compare | The git history of each file |

## Logging in

1. Be a collaborator on **Skaarud/MatMatGame** (Mattis adds you in the repo's Settings → Collaborators).
2. [Create a GitHub token](https://github.com/settings/tokens/new?scopes=repo&description=MatMat%20Games%20Hub) with the **repo** box ticked. Pick a long expiry.
3. Open the hub and paste the token. It is stored only in your browser.

## Things worth knowing

- **Ctrl K** searches everything. **?** shows all shortcuts. **C** new task, **I** new idea, **U** upload.
- Quick add on the board understands `Rig the troll #art !high @me due:fri`.
- In the 3D viewer: **1–5** switch Lit / Clay / Matcap / Normals / UV checker, **W** wireframe, **R** turntable, **P** drop a comment pin, **Space** play/pause the animation.
- The hub checks for changes every 15 seconds while it's open, and shows a toast + Inbox badge when the other person comments, mentions you, assigns you, asks for review, uploads or pitches an idea. GitHub also emails you about comments.
- Files over 100 MB can't go through GitHub; keep big Unreal assets in the game repo as usual.
- Pick **Matrix** or **Ink** at the bottom of the sidebar.

Built with plain HTML/JS (no build step) and three.js (vendored in `vendor/three`, MIT).
