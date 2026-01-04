# /w-security

Security Audit - OWASP top 10, auth/authz, data exposure analysis.

## Usage
```
/w-security [target description]
```

## What Happens
1. **Search** - Find past security findings in this area
2. **Scan** - Run comprehensive security checks
3. **Analyze** - Risk assessment and prioritization
4. **Compound** - Store security patterns

## Checks Performed
- SQL injection
- XSS (Cross-Site Scripting)
- CSRF (Cross-Site Request Forgery)
- Authentication bypass
- Secrets exposure
- Input validation
- Authorization flaws

## Checkpoints
| # | After | You Review |
|---|-------|------------|
| 0 | Search | Past security findings in this area |
| 1 | Scan complete | Vulnerability findings |
| 2 | Analysis done | Risk assessment and priorities |
| 3 | Compound | Security patterns to store |

## Compounds
```
Memory: project/security/[target-area]
Doc: docs/solutions/security/[audit-name].md
```

## Example
```
/w-security authentication module
```
