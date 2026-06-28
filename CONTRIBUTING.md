# Contributing to jspsych-ado

First off, thank you for taking the time to contribute. Contributions from users and developers help make browser-based adaptive experiments easier to build, test, and reuse.

All types of contributions are welcome: from reporting bugs and improving documentation to adding examples, tests, models, demos, or improvements to the adaptive engine.

## How Can I Contribute?

### Reporting Bugs

Before creating a bug report, please check the [Issues](https://github.com/githubpsyche/jspsych-ado/issues) tab to see if the problem has already been reported.

When filing an issue, please include:

- The package version or commit you are using.
- A minimal example or set of steps that reproduces the problem.
- Any error message, console output, or failed test output, if applicable.

### Suggesting Enhancements

If you have an idea for a new feature, such as a new task, model, controller option, or demo:

1. Open an issue to discuss it first.
2. Provide a clear description of the use case and how it would benefit the package.

### Pull Requests (PRs)

1. **Fork** the repository and create your branch from `main`.
2. **Install dependencies**: Run `npm install`.
3. **Implement changes**: Ensure your code follows the existing style.
4. **Add tests**: If you add or change behavior, add or update the relevant tests.
5. **Run tests**: Ensure the relevant checks pass, for example:

   ```bash
   npm test
   ```

6. **Submit**: Open a PR with a concise title and a description of your changes.

## Project Structure

`jspsych-ado` accepts contributions in a few different areas:

- **Core package** changes affect the adaptive engine, controllers, timeline construction, or public API.
- **Models** are reusable packages under `jspsych-ado/models/`.
- **Demos** are example pages under `demos/` that show how to use or extend the package. Demo folders own their task/design/rendering code as ordinary jsPsych experiment code.

For model or demo contributions, start with the relevant README:

- [models README](jspsych-ado/models/README.md)
- [demos README](demos/README.md)

---

## Coding Standards

To keep the codebase maintainable, please keep the following in mind:

- **Experiment/model boundaries**: Experiment code defines presentation, design grids, and response coding. Models define likelihoods, priors, Stan data, compiled Stan artifacts, and response probabilities.
- **Browser-first examples**: Keep demos and examples runnable as static browser pages unless there is a clear reason to require a bundler.
- **Public behavior**: When changing public API behavior, update the relevant tests, documentation, or examples.

## Code of Conduct

By participating in this project, you agree to maintain a respectful, inclusive, and professional environment.
