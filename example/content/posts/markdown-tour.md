---
title: "A tour of the supported Markdown"
date: 2025-02-14
tags:
  - markdown
  - reference
---

## Code

```ts
function greet(name: string): string {
  return `Hello, ${name}!`;
}
```

## Tables

| Feature        | Supported | Notes                  |
|----------------|:---------:|------------------------|
| Headings       |    yes    | ATX style only         |
| Tables         |    yes    | Alignment via `:`      |
| Reference links|    no     | Use inline links       |

## Escaping

Raw HTML is escaped, so `<script>alert(1)</script>` is shown as text:

<script>alert("not executed")</script>

Links with a `javascript:` URL lose their anchor: [click me](javascript:alert(1)).

***

Line one with a hard break  
line two.
