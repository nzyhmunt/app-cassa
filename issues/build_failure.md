## Build Failure: Unexpected token error in CassaTableManager.vue

### Detailed Information:

- During build, the following error was encountered:
  [vite:vue] [vue/compiler-sfc] Unexpected token, expected "," (649:0) /var/www/vhosts/nanawork.it/demo-apps/dev/src/components/CassaTableManager.vue
- Observed at line 1578 in CassaTableManager.vue:
  
  ```javascript
  function processTablePayment(paymentMethodId, extra = {}, overrideAmount = null) {
  ```

- Error possibly due to syntax issue or missing/extra tokens.

### Steps to reproduce:
   1. Checkout the branch related to PR #87.
   2. Run the build process using `npm run build`.

### Expected resolutions:
   - Validate the syntax.
   - Check Babel parser configuration for compatibility with modern JavaScript syntax.