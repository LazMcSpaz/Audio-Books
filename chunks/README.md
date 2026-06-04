# /chunks — Stage 1 output

Save the web app's output here, one folder per book:

```
/chunks/the-time-machine/ch001_part01.txt
/chunks/the-time-machine/ch002_part01.txt
/chunks/the-time-machine/_REVIEW_FLAGS.txt
```

The easiest path: click **Download all as ZIP** in the app and unzip it into
`/chunks/<book-name>/`.

These are the **mechanically cleaned, correctly-sized** chunks plus the
`_REVIEW_FLAGS.txt` list of ambiguities. They are *not yet* finished — the
Stage 2 Claude Code review pass resolves the flags and adds pause tags, writing
the results into `/final/<book-name>/`.
