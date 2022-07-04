
# WheatSystem Integration Tests

This repository contains integration tests for [WheatSystem](http://www.ostracodfiles.com/wheatsystem/menu.html). The tests communicate with WheatSystem implementations over a Unix domain socket. The first implementation I will test is [wheatsystem-c-55a1](https://github.com/ostracod/wheatsystem-c-55a1), but in principle these tests should work with other implementations.

## Usage

This project has the following system-wide dependencies:

* Node.js version ^16.4
* TypeScript version ^4.5
* pnpm version ^6.24

To set up the tests:

1. Install dependencies: `pnpm install`
1. Compile the test code: `npm run build`

To run the tests:

1. Update the contents of `launchWheatSystem.bash` to reference your implementation of WheatSystem.
1. Run tests which are defined in the `./testSuites` directory: `node ./dist/runTests.js`
1. Run heap allocation test: `node ./dist/runTests.js allocation`


