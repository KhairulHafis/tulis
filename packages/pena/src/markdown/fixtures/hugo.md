# Site setup

Shortcodes add small blocks to a page.

{{< note >}}
Back up your content before you start.
{{< /note >}}

Pick your system in the tabs below.

{{% tab name="Linux" %}}
Run the install script from a terminal.
{{% /tab %}}

{{% tab name="Windows" %}}
Run the installer and follow the prompts.
{{% /tab %}}

## Templates

Templates can include shared parts.

{% include note.html %}

The site title is {{ .Site.Title }} and it shows in the header.

## Build

Run the build command from the project folder.
The output goes to the public folder.

Check the result in a browser before you publish.
Fix any broken links that the build reports.

That completes the setup.
