const { parseFrontmatter } = require('../utils/frontmatter')

describe('parseFrontmatter', () => {
  test('parses basic frontmatter', () => {
    const content = `---
name: my-skill
description: A test skill
---
Body content here`

    const result = parseFrontmatter(content)
    expect(result.attributes.name).toBe('my-skill')
    expect(result.attributes.description).toBe('A test skill')
    expect(result.body).toBe('Body content here')
  })

  test('handles quoted values', () => {
    const content = `---
name: "quoted-value"
alt: 'single-quoted'
---
Body`

    const result = parseFrontmatter(content)
    expect(result.attributes.name).toBe('quoted-value')
    expect(result.attributes.alt).toBe('single-quoted')
  })

  test('handles boolean values', () => {
    const content = `---
enabled: true
disabled: false
---
Body`

    const result = parseFrontmatter(content)
    expect(result.attributes.enabled).toBe(true)
    expect(result.attributes.disabled).toBe(false)
  })

  test('returns full content as body when no frontmatter', () => {
    const content = 'Just plain text without frontmatter'
    const result = parseFrontmatter(content)
    expect(result.attributes).toEqual({})
    expect(result.body).toBe(content)
  })

  test('handles empty frontmatter', () => {
    const content = `---
---
Body after empty frontmatter`

    const result = parseFrontmatter(content)
    expect(result.attributes).toEqual({})
    expect(result.body).toContain('Body after empty frontmatter')
  })

  test('handles Windows-style line endings (CRLF)', () => {
    const content = '---\r\nname: test\r\n---\r\nBody'
    const result = parseFrontmatter(content)
    expect(result.attributes.name).toBe('test')
    expect(result.body).toBe('Body')
  })

  test('handles values with colons', () => {
    const content = `---
url: https://example.com
---
Body`

    const result = parseFrontmatter(content)
    expect(result.attributes.url).toBe('https://example.com')
  })
})
