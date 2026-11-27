# Wrapped sentence

This sentence is wrapped over three lines so that the splitter
has to treat each soft wrap as plain whitespace and keep going
until the full stop at the end.

## Second sentence on a wrapped line

The first sentence ends near the end of this line. The second
one starts on a wrapped line and ends here.

## Abbreviation before lowercase

Use a tool, e.g.
pandoc, to convert the file.

## Abbreviation before capital

Use a tool, e.g.
Pandoc, to convert the file.

## Inline code with dots

Run `npm run build.all` first. Then open `dist/index.html` in a browser.

## Link with dots

Read [the docs.example guide](https://docs.example.com/a.b) first. Then continue.

## Bare URL

See https://example.com. Then restart the app.

## Bold UI label

Select **Save**. Then close the dialog.

## Shortcode mid-sentence

Add the {{< ref "setup.md" >}} page to your menu. Then publish it.

## Shortcode after a dot

Open the page. {{< note >}} Then publish it.

## Liquid tag

Set the value {% include "config.html" %} before you start. Then save.

## Numbers

Version 2.4.1 is out. It scales to 3.5 times the old limit.

## Note paragraph

**Note:** Back up your files first. Then start the upgrade.

## Quoted sentence

She said "Stop here." Then she left the room.

## Parenthetical sentence

Start the agent. (It takes a few seconds.) Then check the log.

## Question, exclamation and ellipsis

Did it work? Yes! It did... Then we shipped it.

## etc followed by a capital

Install the usual tools, etc. Then restart the machine.

## Dotted letters and initials

The U.S. team met J. Smith on Monday. They agreed on the plan.

## Footnote reference after a dot

The agent is ready.[^1] Next, start the service.

## Image in a sentence

Click the icon ![gear icon](gear.png) to open settings. Then pick a theme.

## Two-space hard break

First line of the poem.  
Second line of the poem.

## Backslash hard break

First line here\
Second line here

## Table with a line break

| Name | Notes |
| ---- | ----- |
| Alpha | One note.<br>Another note. |
| Beta | Short. Longer one. |

## List with two sentences per item

- Install the agent. Then start it.
- Open the log. Read the last lines.

## Wrapped blockquote

> This quote is wrapped over two lines, so the splitter has to
> join them. Then it finds the second sentence.

## Footnote definition

Some text.[^2]

[^1]: The first note. It has two sentences.
[^2]: A second note.

## Container directive

:::note
Back up first. Then upgrade.
:::

## Code block

```text
This is code. It is not prose.
```

## HTML block

<div>
This is HTML. It is not prose.
</div>

## Step 1. Install the agent

Done.
