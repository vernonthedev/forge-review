### Points to Note: 

- Never use emojies within this project at all. Both in our frontend setup
  or within console logs.
- Use `@/*` path alias only, never `#/*` - `#/*` is deprecated and should not be used.
- Avoid using `---` within our documentation md files to split the sections.
- When creating GitHub issues, or Pull Requests use clean descriptions without
  checkboxes, task lists, or markdown todo items.
- Always use vp (vite plus) as our development package manager setup for
  installations, builds, testings and more, making it the overall configuration
  other than running bare bone `pnpm install`, `pnpm build` kind of runnings.
- Never use mdashes within this project, it is a disease and not required and really
  hated, avoid it and never think about it, even when ur replying to me the developer,
  never use those mdashes.

- Write Typescript in ways that Matt Pocock and Theo t3.gg would be proud of.
- Follow YAGNI Principles and one-liner solutions
- Avoid one-liner solutions that are just casting wrappers.
- `any` is the enemy. Inferred types are our friend.
- Never use single-letter or cryptic abbreviations for variable names, generic
  type parameters, or aliases. Always use full, readable names, e.g.
  `<Success, Failure, Context>` instead of `<A, E, R>`, `item` instead of `i`,
  `project` instead of `p`.
- Keep comments up to date! When making changes, its important to keep things in sync.
- Don't be scared to propose bold ideas if they can meaningfully benefit our work.
- Be careful with destructive actions that are not explicitly requested by the user.
- If your TS code looks like a Python dev wrote it, it is bad TS code.
- If you write 200 lines and it could be 50, rewrite it.

### Documentation

All headings for all `*.md` files should start from the `###` heading variant
and not the `#` or `##` variants. Never use those variants, use the ones below
that `###`. Never use emojies within this project at all. Both in our frontend
setup or within console logs.

**Writing good documentation:** When adding or updating a resource, ensure
all Props and Attrs have JSDoc comments:

```tsx
/**
 * Description of the BucketProps
 * Relevant jsdocs & more properties.
 */
export interface BucketProps {
    /**
     * Name of the bucket. If omitted, a unique name will be generated.
     * Must be lowercase and between 3-63 characters.
     */
    bucketName?: string;

    /**
     * Whether to delete all objects when the bucket is destroyed.
     * @default false
     */
    forceDestroy?: boolean;
}
```

The `@default` tag is used to document default values.

Add clear, simple JSDoc to every module, export, and non-trivial function,
recommended code places for JSDocs first and really core code explaining what it
does and why, in plain terms.

### Commiting

All commits must follow Conventional Commits
One conceptual change per commit.
Body is a bullet list explaining each specific change.
Do not add emojis, checkboxes, or task lists.
All commits should have their relevant scopes & bulleted listed bodies.

```bash
<type>(<scope>): <short summary>

<body (bullet list preferred)>
```

**Types**: `feat`, `fix`, `refactor`, `docs`, `style`, `test`, `chore`,
`ci`, `perf`

## Pull Requests & Github Issues

**Commit messages describe the "why," not a restatement of the diff.**
PR titles usually become commit messages, so for the title **Title**: Use
conventional commit format . Look at the recently merged PRs & git history
for examples. We prefer a concise, human readable title that explains why
the change matters.

**BAD**

> perf(platform): reduce offline notifications sync with remote db.

**GOOD**

> perf(platform): cut time taken for offline notifications to sync with
> remote database by 40%.

Open description with a simple explanation of the problem based on the dev's
original problem or solution, then briefly explain the solution. Do not lead
with an implementation inventory. **Never include a "Test plan", "Testing", or
checklist of TODOs.** PR descriptions document the change, not the
verification process. The description or summary goes at the very top of
the description as plain prose, NO heading above it, no `### Summary`, or
no `### Description`, nothing. The PR title already serves as the title;
do not repeat or re-title it. Only add ### subheadings further down if
the description genuinely has multiple sections worth separating.

Avoid using `---` within our documentation md files to split the sections.

When creating GitHub issues, or Pull Requests use clean descriptions without
checkboxes, task lists, or markdown todo items.

### Other Points to note

- Keep comments up to date! When making changes, its important to keep things in sync.

```bash
<type>(<scope>): <short summary>

<body (bullet list preferred)>
```

**Types**: `feat`, `fix`, `refactor`, `docs`, `style`, `test`, `chore`,
`ci`, `perf`

- All commits should have their relevant scopes & bulleted listed bodies.
- Body is a bullet list explaining each specific change.
- Do not add emojis, checkboxes, or task lists.

For branch namings always prefix using "@forgereview/{branch_name}", the "@" within the branch name is very intended.