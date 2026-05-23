# Contributing to Email Manager Agent

Thank you for your interest in contributing! Here's how you can help.

## Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork**:
   ```bash
   git clone https://github.com/YOUR_USERNAME/My-Email-Manager-Agent.git
   cd My-Email-Manager-Agent
   ```
3. **Create a branch** for your feature:
   ```bash
   git checkout -b feature/my-feature
   ```
4. **Install dependencies**:
   ```bash
   npm install
   ```

## Development

### Running Tests

```bash
npm test              # Run all tests
npm run test:unit     # Unit tests only
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report
```

### Testing Integration

```bash
npm run test:gmail    # Test Gmail API connection
npm run test:slack    # Test Slack webhook
npm run test:integration  # End-to-end email→Slack test
```

### Local Development

```bash
# Start scheduler (checks emails every 3 hours)
npm start

# In another terminal, start webhook server for buttons
npm run server

# Or test a single check
npm run check-emails
```

## Code Style

- **Format**: 2-space indentation
- **Linting**: Use consistent style (no linter currently, but follow existing patterns)
- **Comments**: Document complex logic, especially around:
  - Gmail API filtering (`after:` queries)
  - Rate limiting logic
  - Slack Block Kit structures
- **Error Handling**: Always catch and log errors, never silently fail

## Security Guidelines

- **Never commit `.env`** — it's in `.gitignore`
- **Don't hardcode secrets** — always use `process.env`
- **Validate inputs** — especially account IDs, email IDs, timeframes
- **Sanitize logs** — don't log credentials or sensitive email content
- **Review SECURITY.md** — understand the threat model

## Making Changes

### For Bug Fixes

1. Create a test case that reproduces the bug
2. Fix the bug
3. Ensure test passes
4. Document the fix in commit message

### For Features

1. Open an issue to discuss the feature (optional but recommended)
2. Implement the feature with tests
3. Update relevant documentation (README, docs/, etc.)
4. Add entry to this CONTRIBUTING.md if it affects developer workflow

### Commit Messages

Use clear, descriptive commit messages:

```
Fix Gmail after:0 returning empty results

- Added fallback to newer_than:30d when epoch timestamp fails
- Prevents silent failures on first email check
- Fixes issue #42

Co-authored-by: Author Name <email@example.com>
```

## Documentation

- Update [README.md](README.md) for user-facing changes
- Update [SECURITY.md](SECURITY.md) for security-related changes
- Add doc files in [docs/](docs/) for major features
- Include code comments for complex logic

## Submitting a Pull Request

1. **Push to your fork**:
   ```bash
   git push origin feature/my-feature
   ```

2. **Create a PR** on GitHub with:
   - Clear title describing the change
   - Description of what changed and why
   - Reference to any related issues
   - Screenshot (for UI/message changes)

3. **Wait for review** — maintainers will provide feedback

4. **Address feedback** — push additional commits to the same branch

5. **Merge** — maintainers will merge once approved

## Questions?

- Check existing [issues](https://github.com/acharyarajasekhar/My-Email-Manager-Agent/issues)
- Review [SECURITY.md](SECURITY.md) for security questions
- Check [docs/](docs/) folder for detailed guides

Thank you for contributing! 🎉
