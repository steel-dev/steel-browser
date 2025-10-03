# Fork Sync Guide

This guide explains how to keep your fork (`sasajib/steel-browser`) synchronized with the upstream repository (`steel-dev/steel-browser`) while maintaining custom modifications.

## Current Setup

**Upstream (Original):** `https://github.com/steel-dev/steel-browser`
**Fork (Your Repo):** `git@github.com:sasajib/steel-browser.git`

**Custom Modifications:**
- Session persistence with Redis
- Fingerprint restoration fixes
- Session isolation improvements
- userId-based fingerprint seeding

---

## Initial Setup (Already Done)

```bash
# Add upstream remote
git remote add upstream https://github.com/steel-dev/steel-browser.git

# Verify remotes
git remote -v
# origin    git@github.com:sasajib/steel-browser.git (fetch)
# origin    git@github.com:sasajib/steel-browser.git (push)
# upstream  https://github.com/steel-dev/steel-browser.git (fetch)
# upstream  https://github.com/steel-dev/steel-browser.git (push)
```

---

## Sync Workflow

### Option 1: Merge Upstream Changes (Recommended)

Use this when you want to **preserve your custom commits** and merge upstream updates.

```bash
# 1. Fetch latest from upstream
git fetch upstream

# 2. Checkout your main branch
git checkout main

# 3. Merge upstream changes
git merge upstream/main

# 4. Resolve conflicts if any (see below)

# 5. Push to your fork
git push origin main
```

### Option 2: Rebase on Upstream

Use this for a **cleaner history** (rewrites your commits on top of upstream).

```bash
# 1. Fetch latest from upstream
git fetch upstream

# 2. Checkout your main branch
git checkout main

# 3. Rebase your commits on top of upstream
git rebase upstream/main

# 4. Resolve conflicts if any

# 5. Force push (rewrites history)
git push origin main --force-with-lease
```

⚠️ **Warning:** Only use rebase if you're the only one working on the fork.

---

## Recommended Workflow: Feature Branches

Keep `main` clean and do custom work in feature branches:

```bash
# 1. Keep main synced with upstream
git checkout main
git fetch upstream
git merge upstream/main
git push origin main

# 2. Create feature branches for custom work
git checkout -b custom/session-persistence

# 3. Make your changes
# ... edit files ...

# 4. Commit to feature branch
git commit -m "feat: custom session persistence"

# 5. Push feature branch
git push origin custom/session-persistence

# 6. When upstream updates, rebase your feature branch
git fetch upstream
git rebase upstream/main
git push origin custom/session-persistence --force-with-lease
```

**Benefits:**
- Clean `main` branch matches upstream
- Custom changes isolated in feature branches
- Easy to update from upstream without conflicts

---

## Handling Conflicts

### Strategy 1: Accept Upstream, Reapply Custom Changes

```bash
# During merge conflict
git merge upstream/main

# For files with conflicts:
# 1. Accept upstream version
git checkout --theirs api/src/services/cdp/cdp.service.ts

# 2. Stage it
git add api/src/services/cdp/cdp.service.ts

# 3. After merge completes, reapply your custom changes
# Edit the file and add your modifications back

# 4. Commit the reapplied changes
git commit -m "feat: reapply fingerprint persistence after upstream sync"
```

### Strategy 2: Selective Merge

```bash
# Accept your version for specific files
git checkout --ours api/src/services/session.service.ts

# Accept upstream for specific files
git checkout --theirs api/src/modules/actions/actions.controller.ts

# Manually merge conflicts in critical files
# Edit: api/src/services/cdp/cdp.service.ts
# Look for conflict markers: <<<<<<<, =======, >>>>>>>

git add .
git merge --continue
```

---

## Automated Sync Script

Create a helper script for regular syncing:

```bash
#!/bin/bash
# sync-upstream.sh

set -e

echo "🔄 Syncing with upstream steel-dev/steel-browser..."

# Fetch upstream
echo "1. Fetching upstream..."
git fetch upstream

# Show what's new
echo "2. New commits in upstream:"
git log --oneline HEAD..upstream/main | head -10

# Ask for confirmation
read -p "Proceed with merge? (y/n) " -n 1 -r
echo

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "3. Merging upstream/main..."
    git merge upstream/main

    echo "4. Pushing to origin..."
    git push origin main

    echo "✅ Sync complete!"
else
    echo "❌ Sync cancelled"
fi
```

**Usage:**
```bash
chmod +x sync-upstream.sh
./sync-upstream.sh
```

---

## Check What's Different

### Compare Your Fork with Upstream

```bash
# Show commits in your fork not in upstream
git log upstream/main..main --oneline

# Show commits in upstream not in your fork
git log main..upstream/main --oneline

# Show file-level differences
git diff upstream/main..main --stat
```

### Check Specific Files

```bash
# See if a file differs from upstream
git diff upstream/main main -- api/src/services/cdp/cdp.service.ts

# List files that differ
git diff --name-only upstream/main main
```

---

## Regular Sync Schedule

**Recommended:** Sync weekly or before starting major work

```bash
# Weekly sync
git checkout main
git fetch upstream
git merge upstream/main
git push origin main

# Before starting new feature
git checkout main
git pull origin main
git fetch upstream
git merge upstream/main
git checkout -b feature/new-work
```

---

## Handling Your Custom Changes

### Protected Files (Heavy Custom Changes)

These files have significant custom modifications:

- `api/src/services/cdp/cdp.service.ts` (+150 lines)
- `api/src/services/session.service.ts` (+50 lines)
- `api/src/services/session-persistence.service.ts` (new service)
- `docs/PERSISTENCE_EXAMPLES.md` (new documentation)

**Strategy:** When these conflict, carefully review and merge manually.

### Safe to Update from Upstream

These are likely safe to accept upstream changes:

- `ui/` directory (if you haven't customized UI)
- `docs/` (except your custom docs)
- `examples/`
- Config files (unless customized)

---

## Example: Syncing After Upstream Updates

```bash
# Scenario: Upstream added new features, you have custom session persistence

# 1. Fetch and check what's new
git fetch upstream
git log --oneline main..upstream/main

# Example output:
# abc1234 feat: new browser extension support
# def5678 fix: memory leak in CDP service
# ghi9012 docs: update README

# 2. Merge upstream
git checkout main
git merge upstream/main

# 3. If conflicts in api/src/services/cdp/cdp.service.ts:
# CONFLICT (content): Merge conflict in api/src/services/cdp/cdp.service.ts

# 4. Open file and resolve conflicts
# Look for markers:
# <<<<<<< HEAD (your changes)
# your code
# =======
# upstream code
# >>>>>>> upstream/main

# 5. Keep both changes or merge them
# Edit file to combine both sets of changes

# 6. Mark as resolved
git add api/src/services/cdp/cdp.service.ts

# 7. Complete merge
git commit

# 8. Push
git push origin main
```

---

## Contributing Back to Upstream

If you want to contribute your fixes back to the original repository:

```bash
# 1. Create a clean branch from upstream/main
git checkout -b feature/fingerprint-fixes upstream/main

# 2. Cherry-pick your changes (without unrelated commits)
git cherry-pick <commit-hash>

# 3. Push to your fork
git push origin feature/fingerprint-fixes

# 4. Create PR to steel-dev/steel-browser
gh pr create --repo steel-dev/steel-browser \
  --title "fix: fingerprint persistence for sticky sessions" \
  --body "Description of changes..."
```

---

## Best Practices

### ✅ Do

- Sync regularly (weekly or before major work)
- Use feature branches for custom changes
- Document your custom modifications
- Test after each sync
- Keep `main` branch deployable

### ❌ Don't

- Work directly on `main` for custom features
- Force push to `main` if others use your fork
- Ignore upstream updates for months
- Delete upstream remote

---

## Quick Reference

```bash
# Check sync status
git fetch upstream
git log --oneline HEAD..upstream/main | wc -l  # Commits behind

# Quick sync (no conflicts expected)
git checkout main && git fetch upstream && git merge upstream/main && git push

# Check what files changed upstream
git fetch upstream
git diff --name-only main upstream/main

# Undo a bad merge
git reset --hard HEAD@{1}  # Reset to before merge
```

---

## Emergency: Reset Fork to Upstream

If your fork gets too diverged and you want to start fresh:

```bash
# ⚠️ WARNING: This discards all custom changes!

# 1. Backup your custom commits
git checkout -b backup-before-reset

# 2. Reset main to upstream
git checkout main
git reset --hard upstream/main

# 3. Force push (overwrites your fork)
git push origin main --force

# 4. Cherry-pick custom commits from backup
git cherry-pick <commit-from-backup>
```

---

## Workflow Summary

**For Regular Development:**
1. Work on feature branches
2. Keep `main` synced with upstream
3. Rebase feature branches on updated `main`

**For Urgent Fixes:**
1. Branch from `main`
2. Fix, commit, push
3. Sync `main` with upstream later

**For Contributing Back:**
1. Branch from `upstream/main`
2. Cherry-pick clean commits
3. PR to steel-dev/steel-browser

---

## Checking Sync Status

```bash
# Are you behind upstream?
git fetch upstream
git rev-list --count HEAD..upstream/main
# Output: 0 (in sync) or N (N commits behind)

# Are you ahead of upstream?
git rev-list --count upstream/main..HEAD
# Output: Number of custom commits
```

---

## Your Current Status

```bash
# Check your current state
git log --oneline --graph --all --decorate -10

# Your custom commits since fork
git log --oneline upstream/main..main
```

Based on your current setup, you're **1 commit ahead** of origin with your fingerprint fixes. After pushing, you can continue syncing with upstream as needed.
