# Ignore comments

<!-- tulis-ignore -->
Plain next block.

<!-- tulis-ignore term.sign-in -->
Paragraph with one check.

<!-- tulis-ignore term.sign-in, style.passive -->
Paragraph with two checks.

<!-- tulis-ignore: quoted from the vendor -->
Paragraph with a reason.

<!-- tulis-ignore term.sign-in: quoted from the vendor -->
Paragraph with a check and a reason.

<!-- tulis-ignore-start term.sign-in, style.passive: legacy section -->

Inside the range.

<!-- tulis-ignore-end -->

<!-- TODO: an ordinary comment -->

Text with <!-- tulis-ignore --> an inline comment.

Example in code:

```md
<!-- tulis-ignore -->
```

Inline `<!-- tulis-ignore -->` code.

{/* tulis-ignore */}

Last paragraph.
