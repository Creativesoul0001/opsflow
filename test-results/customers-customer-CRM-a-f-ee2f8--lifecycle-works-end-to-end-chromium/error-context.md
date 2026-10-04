# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: customers.spec.ts >> customer CRM >> a full customer lifecycle works end to end
- Location: tests\e2e\customers.spec.ts:39:7

# Error details

```
Error: expect(page).toHaveURL(expected) failed

Expected pattern: /\/login($|\?)/
Received string:  "http://127.0.0.1:3100/register"
Timeout: 10000ms

Call log:
  - Expect "toHaveURL" with timeout 10000ms
    23 × locator resolved to <html lang="en">…</html>
       - unexpected value "http://127.0.0.1:3100/register"

```

```yaml
- banner: OpsFlow
- main:
  - heading "Create your OpsFlow account" [level=1]
  - paragraph: You will also create your first organization and become its owner.
  - text: Your name
  - textbox "Your name"
  - text: Work email
  - textbox "Work email"
  - text: Password
  - textbox "Password"
  - paragraph: At least 12 characters, with upper case, lower case and a number.
  - text: Organization name
  - textbox "Organization name"
  - button "Create account"
  - paragraph:
    - text: Already have an account?
    - link "Sign in":
      - /url: /login
- contentinfo: Multi-tenant business operations platform
```

# Test source

```ts
  1   | import { expect, test, type Page } from '@playwright/test';
  2   | 
  3   | /**
  4   |  * Customer CRM end-to-end flow.
  5   |  *
  6   |  * Walks the whole module the way a member would: register an organization, add
  7   |  * a customer, find it again through search and filters, edit it, add a note,
  8   |  * watch the timeline record each action, then archive it and confirm it leaves
  9   |  * the default list but stays retrievable.
  10  |  *
  11  |  * Requires a reachable database (`npm run db:deploy && npm run db:seed`) and a
  12  |  * running app. Not part of `npm run verify`, because it depends on external
  13  |  * infrastructure; run it explicitly with `npm run test:e2e`.
  14  |  */
  15  | 
  16  | const stamp = Date.now();
  17  | const email = `e2e-customers-${stamp}@opsflow.test`;
  18  | const organization = `E2E Customers ${stamp}`;
  19  | const PASSWORD = 'Correct-Horse-9';
  20  | 
  21  | async function registerAndSignIn(page: Page) {
  22  |   await page.goto('/register');
  23  |   await page.getByLabel('Your name').fill('CRM Tester');
  24  |   await page.getByLabel('Work email').fill(email);
  25  |   await page.getByLabel('Password').fill(PASSWORD);
  26  |   await page.getByLabel('Organization name').fill(organization);
  27  |   await page.getByRole('button', { name: 'Create account' }).click();
  28  | 
  29  |   // Wait for navigation to complete.
> 30  |   await expect(page).toHaveURL(/\/login($|\?)/);
      |                      ^ Error: expect(page).toHaveURL(expected) failed
  31  | 
  32  |   await page.getByLabel('Email').fill(email);
  33  |   await page.getByLabel('Password').fill(PASSWORD);
  34  |   await page.getByRole('button', { name: 'Sign in' }).click();
  35  |   await expect(page).toHaveURL(/\/dashboard/);
  36  | }
  37  | 
  38  | test.describe('customer CRM', () => {
  39  |   test('a full customer lifecycle works end to end', async ({ page }) => {
  40  |     await registerAndSignIn(page);
  41  | 
  42  |     // ---- The module is reachable from the shell, not just by typing a URL.
  43  |     await page.getByRole('link', { name: 'Customers' }).first().click();
  44  |     await expect(page).toHaveURL(/\/customers$/);
  45  | 
  46  |     // ---- Create
  47  |     await page.getByRole('link', { name: 'Add customer' }).click();
  48  |     await expect(page).toHaveURL(/\/customers\/new$/);
  49  | 
  50  |     await page.getByLabel('First name').fill('Grace');
  51  |     await page.getByLabel('Last name').fill('Hopper');
  52  |     await page.getByLabel('Email').fill(`grace-${stamp}@example.com`);
  53  |     await page.getByLabel('Phone').fill('+1 555 0142');
  54  |     await page.getByLabel('Company name').fill('Navy');
  55  |     await page.getByRole('button', { name: 'Create customer' }).click();
  56  | 
  57  |     // Creating redirects straight to the new record.
  58  |     await expect(page).toHaveURL(/\/customers\/[0-9a-f-]{36}$/);
  59  |     await expect(page.getByRole('heading', { name: 'Grace Hopper' })).toBeVisible();
  60  |     await expect(page.getByText('Navy · Added')).toBeVisible();
  61  | 
  62  |     // ---- The timeline recorded the creation.
  63  |     await expect(page.getByText('Customer created by CRM Tester')).toBeVisible();
  64  | 
  65  |     const customerUrl = page.url();
  66  | 
  67  |     // ---- The customer is findable in the list.
  68  |     await page.goto('/customers');
  69  |     await page.getByRole('link', { name: 'Customers' }).first().waitFor();
  70  |     await expect(page.getByRole('cell', { name: 'Grace Hopper' })).toBeVisible();
  71  | 
  72  |     // ---- Search narrows the list.
  73  |     await page.getByLabel('Search customers').fill('Hopper');
  74  |     await expect(page.getByRole('cell', { name: 'Grace Hopper' })).toBeVisible();
  75  | 
  76  |     await page.getByLabel('Search customers').fill('NoSuchCustomer');
  77  |     await expect(page.getByText('No customers match these filters')).toBeVisible();
  78  |     await expect(page.getByRole('cell', { name: 'Grace Hopper' })).toHaveCount(0);
  79  | 
  80  |     // ---- Edit
  81  |     await page.goto(customerUrl);
  82  |     await page.getByRole('button', { name: 'Edit' }).click();
  83  |     await expect(page).toHaveURL(/\/edit$/);
  84  | 
  85  |     await page.getByLabel('Company name').fill('US Navy');
  86  |     await page.getByRole('button', { name: 'Save changes' }).click();
  87  | 
  88  |     await expect(page).toHaveURL(new RegExp(`${customerUrl.split('/').pop()}$`));
  89  |     await expect(page.getByText('US Navy')).toBeVisible();
  90  |     await expect(page.getByText('Customer details updated by CRM Tester')).toBeVisible();
  91  | 
  92  |     // ---- A note is appended and recorded.
  93  |     await page.getByLabel('Add a note').fill('Requested a follow-up call.');
  94  |     await page.getByRole('button', { name: 'Add note' }).click();
  95  |     await expect(page.getByText('Requested a follow-up call.')).toBeVisible();
  96  |     await expect(page.getByText('Note added by CRM Tester')).toBeVisible();
  97  | 
  98  |     // ---- Archive is a deliberate two-step action.
  99  |     await page.getByRole('button', { name: 'Archive' }).click();
  100 |     await expect(page.getByText('Archive this customer?')).toBeVisible();
  101 |     await page.getByRole('button', { name: 'Confirm archive' }).click();
  102 | 
  103 |     await expect(page.getByText('Archived customer')).toBeVisible();
  104 |     await expect(page.getByText('Customer archived by CRM Tester')).toBeVisible();
  105 | 
  106 |     // Archived records leave the default list...
  107 |     await page.goto('/customers');
  108 |     await expect(page.getByRole('cell', { name: 'Grace Hopper' })).toHaveCount(0);
  109 | 
  110 |     // ...but the record and its history are retained, not deleted.
  111 |     await page.goto(customerUrl);
  112 |     await expect(page.getByText('Archived customer')).toBeVisible();
  113 |     await expect(page.getByText('Note added by CRM Tester')).toBeVisible();
  114 |   });
  115 | 
  116 |   test('the API refuses unauthenticated and cross-tenant access', async ({ page, request }) => {
  117 |     await registerAndSignIn(page);
  118 | 
  119 |     await page.goto('/customers/new');
  120 |     await page.getByLabel('First name').fill('Tenant');
  121 |     await page.getByLabel('Last name').fill('Probe');
  122 |     await page.getByLabel('Email').fill(`probe-${stamp}@example.com`);
  123 |     await page.getByRole('button', { name: 'Create customer' }).click();
  124 |     await expect(page).toHaveURL(/\/customers\/[0-9a-f-]{36}$/);
  125 |     const customerId = page.url().split('/').pop();
  126 | 
  127 |     // A signed-out client gets 401, not data.
  128 |     await page.context().clearCookies();
  129 |     const anonymous = await request.get(`/api/customers/${customerId}`);
  130 |     expect(anonymous.status()).toBe(401);
```