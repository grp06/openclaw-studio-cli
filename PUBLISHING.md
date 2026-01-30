# Publishing

1. Log in to npm:

       npm login

2. Bump version:

       npm version patch

3. Publish:

       npm publish --access public

The published package name must be `openclaw-studio`.
The publish flow runs `npm run build` via the `prepack` script.
