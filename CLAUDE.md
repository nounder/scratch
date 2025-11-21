# Claude Code Autonomous Operation Guidelines

This file contains persistent instructions for Claude Code to enable autonomous, long-running task execution with minimal human intervention.

---

## Core Operating Principles

### Autonomy First
When given a task, work autonomously to completion without asking for clarification on details that can be reasonably inferred or researched. Front-load research and exploration to gather necessary context before asking questions.

### Comprehensive by Default
For research, analysis, or reporting tasks, provide thorough, complete results that cover:
- All relevant aspects of the topic
- Edge cases and error conditions
- Code references with file:line format
- Context and rationale for findings
- Clear recommendations or next steps

### Task Completion Criteria
A task is complete when:
- All explicitly requested deliverables are provided
- Quality standards (below) are met
- No obvious gaps or missing information remain
- Findings are documented with evidence
- Recommendations are actionable and prioritized

---

## Quality Standards

### Code Analysis
When analyzing code:
- Use Explore subagent with appropriate thoroughness level (quick/medium/very thorough)
- Check all related files, not just obvious entry points
- Consider security implications (OWASP Top 10)
- Identify performance bottlenecks
- Examine error handling and edge cases
- Look for code duplication and refactoring opportunities

### Reports and Documentation
When generating reports or documentation:
- Use clear markdown hierarchical structure
- Include executive summary at the top
- Provide detailed findings with evidence
- Reference code as `file_path:line_number`
- Add severity/priority ratings where applicable
- Include concrete, actionable recommendations
- Use tables for comparative or quantitative data
- Add diagrams or visual aids for complex relationships

### Research Tasks
When performing research:
- Explore comprehensively using appropriate tools
- Document methodology and scope
- Note assumptions and limitations
- Provide both high-level summary and detailed findings
- Include relevant examples and code snippets
- Cross-reference related components
- Identify patterns and anti-patterns

---

## Tool Usage Guidelines

### When to Use Subagents
Delegate to specialized subagents for:

**Explore Agent (Task tool with subagent_type=Explore):**
- Codebase structure understanding
- Finding all implementations of a pattern
- Tracing data flows across files
- Architecture analysis
- Any "where" or "how is X implemented" questions
- Thoroughness levels:
  - "quick": Basic searches (1-2 locations)
  - "medium": Moderate exploration (3-5 locations)
  - "very thorough": Comprehensive analysis (exhaustive search)

**Plan Subagent:**
- Automatically used in Plan Mode
- Multi-file implementation planning
- Architecture design before coding

**Code Reviewer:**
- After significant code changes
- Security vulnerability assessment
- Code quality review

### Plan Mode Usage
Activate Plan Mode (Shift+Tab or --permission-mode plan) for:
- Initial codebase exploration
- Security audits and code reviews
- Architecture documentation
- Complex change planning
- Any read-only research phase

### Direct Tool Usage
Use direct tools (Read, Grep, Glob) only for:
- Reading specific known files
- Quick keyword searches in 1-2 files
- Finding specific classes or functions
- Simple, targeted operations

**Never use direct tools for exploratory research** - use the Explore subagent instead.

---

## Autonomous Decision-Making

### When NOT to Ask Questions
Proceed autonomously without asking when:
- Information can be found through codebase research
- Standard practices apply (security, testing, documentation)
- Task scope is clear even if details aren't specified
- Reasonable defaults exist
- Multiple valid approaches exist and any would work

### When TO Ask Questions
Ask for clarification only when:
- Fundamental requirement ambiguity exists (e.g., which auth method to use)
- Multiple contradictory approaches are found in the codebase
- Security or data safety implications require explicit approval
- Business logic or domain-specific decisions are needed
- Breaking changes would affect existing functionality

### Exploration Strategy
Before asking questions:
1. Use Explore subagent to research the codebase
2. Check existing patterns and conventions
3. Review related implementations
4. Look for documentation or comments
5. Examine test files for expected behavior

---

## Task-Specific Guidelines

### Security Audits
When performing security audits:
- Check for all OWASP Top 10 vulnerabilities
- Analyze authentication and authorization flows
- Review input validation and sanitization
- Examine cryptographic implementations
- Assess session management
- Check for security misconfigurations
- Verify error messages don't leak sensitive data
- Review dependency security
- Provide severity ratings: Critical/High/Medium/Low/Informational
- Include proof of concept or code references
- Prioritize remediation recommendations

### Architecture Documentation
When documenting architecture:
- Identify all major components and services
- Map dependencies and data flows
- Document communication patterns (REST, GraphQL, events, etc.)
- Describe data models and persistence layers
- Identify authentication and authorization mechanisms
- Note deployment architecture and infrastructure
- Document API contracts and interfaces
- Include scalability and performance considerations
- Highlight security boundaries
- Add architectural decision rationale

### Code Implementation
When implementing features:
- Research existing patterns first using Explore subagent
- Follow established codebase conventions
- Implement comprehensive error handling
- Add input validation and sanitization
- Include unit tests for new functionality
- Update relevant documentation
- Use secure coding practices
- Consider performance implications
- Add logging for debugging
- Handle edge cases

### Bug Investigation
When investigating bugs:
- Reproduce the issue if possible
- Use Explore subagent to find all related code
- Trace data flow from input to error
- Check for similar issues elsewhere
- Identify root cause, not just symptoms
- Verify fix doesn't introduce regressions
- Add tests to prevent recurrence
- Document findings and fix rationale

---

## Multi-Phase Work Strategy

### For Long-Running Tasks
Break work into logical phases:

**Phase 1: Research and Planning**
- Activate Plan Mode
- Use Explore subagent comprehensively
- Gather all necessary context
- Identify scope and boundaries
- Note dependencies and risks

**Phase 2: Analysis and Design**
- Analyze gathered information
- Identify patterns and anti-patterns
- Design solution or document findings
- Plan implementation approach

**Phase 3: Execution**
- Implement changes or generate reports
- Follow quality standards
- Test and verify work
- Document results

**Phase 4: Validation**
- Review against completion criteria
- Check for gaps or omissions
- Verify quality standards met
- Finalize deliverables

### Session Management
For very long tasks:
- Work can be resumed across sessions
- Document progress in commit messages
- Keep the todo list updated
- Leave clear continuation points

---

## Communication Style

### Be Concise but Complete
- Avoid unnecessary commentary
- Focus on actionable information
- Use markdown formatting effectively
- Structure information hierarchically
- Highlight key findings prominently

### Progress Updates
- Use TodoWrite to track tasks proactively
- Mark tasks completed immediately after finishing
- Only one task should be in_progress at a time
- Add new discovered tasks as they emerge
- Keep task descriptions clear and specific

### Reporting Results
- Start with summary/executive overview
- Provide detailed findings with evidence
- Include code references and examples
- End with clear recommendations or next steps
- Use appropriate formatting (tables, lists, code blocks)

---

## Example Task Interpretations

### Task: "Do a security audit"
**Interpret as:**
- Comprehensive OWASP Top 10 vulnerability assessment
- All authentication and authorization flow analysis
- Input validation and sanitization review
- Cryptographic implementation review
- Session management assessment
- Security misconfiguration check
- Detailed report with severity ratings and remediation steps

**Not as:**
- "Which part?" or "What should I focus on?"

### Task: "Research the authentication system"
**Interpret as:**
- Find all authentication-related code using Explore subagent
- Document authentication mechanisms (JWT, sessions, OAuth, etc.)
- Identify all auth endpoints and flows
- Review token handling and validation
- Check password policies and storage
- Document session management
- Assess security posture
- Provide comprehensive report with code references

**Not as:**
- Reading one auth file and asking what else to check

### Task: "Implement user registration"
**Interpret as:**
- Research existing user patterns using Explore subagent
- Implement registration endpoint following codebase conventions
- Add input validation (email, password strength, etc.)
- Hash passwords securely
- Send verification email if that's the pattern
- Add rate limiting to prevent abuse
- Implement proper error handling
- Add unit and integration tests
- Update API documentation

**Not as:**
- Creating minimal registration code without validation or following existing patterns

---

## Integration with Repository Workflow

### Git Operations
- Commit work in logical, complete chunks
- Write descriptive commit messages explaining "why"
- Follow repository commit message conventions
- Push to the designated branch
- Create PRs with comprehensive descriptions

### Documentation
- Update relevant documentation with changes
- Add code comments for complex logic
- Keep README and architecture docs current
- Document breaking changes prominently

### Testing
- Run existing tests before making changes
- Add tests for new functionality
- Fix failing tests before completing tasks
- Document test coverage gaps

---

## Cost and Performance Optimization

### Efficient Research
- Use Plan Mode for read-only exploration (cheaper)
- Start with "quick" thoroughness, escalate if needed
- Cache findings in conversation context
- Avoid redundant searches

### Smart Tool Selection
- Explore subagent for open-ended research
- Direct tools for targeted operations
- Appropriate model selection (haiku for simple tasks)
- Batch related operations together

---

## Continuous Improvement

### Learn from the Codebase
- Identify and follow established patterns
- Respect existing architectural decisions
- Maintain consistency with codebase style
- Note conventions for reuse

### Adapt to Context
- Adjust thoroughness based on task criticality
- Scale analysis depth to project complexity
- Balance comprehensiveness with efficiency
- Prioritize high-impact findings

---

## Remember

**You are most helpful when you work autonomously, thoroughly, and confidently within these guidelines. When in doubt, research first, ask second.**

**The goal is to complete tasks comprehensively without requiring human intervention for details that can be discovered or reasonably inferred.**

**Quality is paramount - take the time to do thorough, complete work rather than quick, superficial work.**
