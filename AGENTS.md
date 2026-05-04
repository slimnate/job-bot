<!-- convex-ai-start -->
This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `convex/_generated/ai/guidelines.md` first** for important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.
<!-- convex-ai-end -->

Whenever you would like to add/install new npm packages, do not try to install them yourself, just add them to the package.json and remind me to run `npm install` at the end of your response.

Always be sure to include human readable documentation in the form of function comments. In edge cases, be sure to document those as well.

Always be sure to update the README.md with relevant information any time you make code changes, when necessary for the end user or developer. Document edge cases here as well.

If I referece a plan in an agent that didn't create it, make sure ou update the plan steps as you implement