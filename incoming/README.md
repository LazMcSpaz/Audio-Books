# /incoming — source books

Drop your original public-domain source files here, one folder per book:

```
/incoming/the-time-machine/the-time-machine.txt
/incoming/dracula/dracula.epub
```

These are the inputs you feed into the **Stage 1** web app (`.txt`, `.epub`, or
`.pdf`). The app reads them in your browser — it does not read this folder
directly; this folder is just where you keep originals so the pipeline stays
organized.

Next step: process a file in the app, then save its output into
`/chunks/<book-name>/`.
