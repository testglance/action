import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseJunitXml } from '../../parsers/junit';
import {
  isRepoFile,
  normalizePath,
  parseFailureMessageLocation,
  parseFileLocation,
} from '../parse-stack-trace';

describe('parseFailureMessageLocation', () => {
  it('reads a diagnostic line from captured test output', () => {
    const message = `Test Case 'A.testB' started at 2026-11-02 20:12:40.194
/work/app/My Tests/A+B.swift:6: error: A.testB : XCTAssertEqual failed
Test Case 'A.testB' failed (0.001 seconds)`;

    expect(parseFailureMessageLocation(message, '/work/app')).toEqual({
      path: 'My Tests/A+B.swift',
      line: 6,
    });
  });

  it('ignores a path that is not a diagnostic at the start of a line', () => {
    expect(parseFailureMessageLocation('see Tests/A.swift:3 for details')).toBeNull();
    expect(parseFailureMessageLocation('Tests/A.swift:3 was unreadable')).toBeNull();
    expect(parseFailureMessageLocation('wrong: Tests/A.swift:3: error: x')).toBeNull();
  });

  it('skips diagnostics in dependency code', () => {
    const message = `.build/checkouts/lib/Sources/Lib.swift:4: error: boom
Tests/A.swift:9: error: failed`;

    expect(parseFailureMessageLocation(message)).toEqual({ path: 'Tests/A.swift', line: 9 });
  });

  it('returns null for an empty message', () => {
    expect(parseFailureMessageLocation('')).toBeNull();
  });
});

describe('parseFileLocation', () => {
  describe('JS/TS stack traces', () => {
    it('parses "at Object.<anonymous> (path:line:col)" format', () => {
      const trace = `Error: expected true
    at Object.<anonymous> (src/foo.test.ts:42:5)
    at Module._compile (node_modules/v8-compile-cache/v8-compile-cache.js:192:30)`;

      expect(parseFileLocation(trace)).toEqual({ path: 'src/foo.test.ts', line: 42 });
    });

    it('parses "at path:line:col" format without parens', () => {
      const trace = `Error: boom
    at src/utils/helper.ts:15:3`;

      expect(parseFileLocation(trace)).toEqual({ path: 'src/utils/helper.ts', line: 15 });
    });

    it('parses "at FunctionName (path:line:col)" format', () => {
      const trace = `Error: fail
    at myFunc (src/core/engine.ts:100:12)`;

      expect(parseFileLocation(trace)).toEqual({ path: 'src/core/engine.ts', line: 100 });
    });
  });

  describe('Python stack traces', () => {
    it('parses File "path", line N format', () => {
      const trace = `Traceback (most recent call last):
  File "tests/test_foo.py", line 42, in test_something
    assert result == expected
AssertionError: 1 != 2`;

      expect(parseFileLocation(trace)).toEqual({ path: 'tests/test_foo.py', line: 42 });
    });
  });

  describe('Java/Kotlin stack traces', () => {
    it('parses at package.Class(File.java:N) format', () => {
      const trace = `java.lang.AssertionError: expected:<3> but was:<4>
	at com.example.FooTest.testAdd(FooTest.java:42)
	at java.base/jdk.internal.reflect.NativeMethodAccessorImpl.invoke0(Native Method)`;

      expect(parseFileLocation(trace)).toEqual({ path: 'FooTest.java', line: 42 });
    });

    it('parses at package.Class(File.kt:N) format', () => {
      const trace = `java.lang.AssertionError: expected:<3> but was:<4>
	at com.example.FooTest.testAdd(FooTest.kt:42)
	at java.base/jdk.internal.reflect.NativeMethodAccessorImpl.invoke0(Native Method)`;

      expect(parseFileLocation(trace)).toEqual({ path: 'FooTest.kt', line: 42 });
    });

    it('skips JUnit assertion frames before the user frame', () => {
      const trace = `java.lang.AssertionError: expected:<3> but was:<4>
	at org.junit.Assert.fail(Assert.java:89)
	at org.junit.Assert.failNotEquals(Assert.java:835)
	at com.example.FooTest.testAdd(FooTest.java:42)`;

      expect(parseFileLocation(trace)).toEqual({ path: 'FooTest.java', line: 42 });
    });

    it('skips Kotest matcher frames', () => {
      const trace = `io.kotest.assertions.AssertionFailedError: expected:<3> but was:<4>
	at io.kotest.matchers.ShouldKt.invokeMatcher(should.kt:42)
	at io.kotest.matchers.ShouldKt.shouldBe(should.kt:10)
	at com.example.FooSpec$1$1.invokeSuspend(FooSpec.kt:12)`;

      expect(parseFileLocation(trace)).toEqual({ path: 'FooSpec.kt', line: 12 });
    });

    it('parses Scala, Groovy, and Kotlin script frames', () => {
      expect(parseFileLocation('\tat com.example.FooSpec.test(FooSpec.scala:12)')).toEqual({
        path: 'FooSpec.scala',
        line: 12,
      });
      expect(parseFileLocation('\tat com.example.FooSpec.test(FooSpec.groovy:7)')).toEqual({
        path: 'FooSpec.groovy',
        line: 7,
      });
      expect(parseFileLocation('\tat Build_gradle.<init>(build.gradle.kts:10)')).toEqual({
        path: 'build.gradle.kts',
        line: 10,
      });
    });

    it('returns null when only JVM library frames exist', () => {
      const trace = `java.lang.NullPointerException
	at java.base/java.util.Objects.requireNonNull(Objects.java:233)
	at app//org.junit.platform.commons.util.ReflectionUtils.invokeMethod(ReflectionUtils.java:727)`;

      expect(parseFileLocation(trace)).toBeNull();
    });
  });

  describe('Kotlin Gradle report (junit-kotlin-gradle.xml)', () => {
    const suites = parseJunitXml(
      readFileSync(join(__dirname, '../../../fixtures/junit-kotlin-gradle.xml'), 'utf-8'),
    ).suites;
    const locate = (name: string) =>
      parseFileLocation(
        suites.flatMap((s) => s.tests).find((t) => t.name === name)!.stackTrace as string,
      );

    it('skips kotlin.test frames and resolves an app//-prefixed backtick test name', () => {
      expect(locate('adding two numbers returns sum()')).toEqual({
        path: 'CalculatorTest.kt',
        line: 15,
      });
    });

    it('resolves a constructor <init> frame', () => {
      expect(locate('rejects negative balance()')).toEqual({ path: 'Account.kt', line: 9 });
    });

    it('resolves a coroutine lambda frame past kotlin.test and kotlinx frames', () => {
      expect(locate('loads account()')).toEqual({ path: 'AccountTest.kt', line: 30 });
    });
  });

  describe('Go stack traces', () => {
    it('parses file_test.go:N format', () => {
      const trace = `--- FAIL: TestAdd (0.00s)
    foo_test.go:42: expected 3, got 4`;

      expect(parseFileLocation(trace)).toEqual({ path: 'foo_test.go', line: 42 });
    });

    it('parses path/file_test.go:N format', () => {
      const trace = `--- FAIL: TestAdd (0.00s)
    pkg/math/calc_test.go:15: wrong result`;

      expect(parseFileLocation(trace)).toEqual({ path: 'pkg/math/calc_test.go', line: 15 });
    });
  });

  describe('Ruby stack traces', () => {
    it('parses spec/foo_spec.rb:N:in format', () => {
      const trace = `RSpec::Expectations::ExpectationNotMetError:
  expected: 3
       got: 4
# spec/foo_spec.rb:42:in \`block (2 levels) in <top (required)>'`;

      expect(parseFileLocation(trace)).toEqual({ path: 'spec/foo_spec.rb', line: 42 });
    });
  });

  describe('.NET stack traces', () => {
    it('parses "in /path/File.cs:line N" format', () => {
      const trace = `System.Exception: Test failed
   at MyProject.Tests.FooTest.TestAdd() in /home/runner/work/MyProject/Tests/FooTest.cs:line 42`;

      expect(parseFileLocation(trace)).toEqual({
        path: 'home/runner/work/MyProject/Tests/FooTest.cs',
        line: 42,
      });
    });
  });

  describe('Swift stack traces', () => {
    it('parses XCTest "path.swift:line: error:" format', () => {
      const trace = `/Users/runner/work/hats/hats/Tests/HatsCoreTests/ProfileTests.swift:12: error: -[ProfileNameTests testRejects] : XCTAssertEqual failed`;

      expect(parseFileLocation(trace)).toEqual({
        path: 'Users/runner/work/hats/hats/Tests/HatsCoreTests/ProfileTests.swift',
        line: 12,
      });
    });

    it('parses Swift Testing "path.swift:line:column" format', () => {
      const trace = `Tests/HatsCoreTests/ProfileTests.swift:8:6: error: Expectation failed: 1 == 2`;

      expect(parseFileLocation(trace)).toEqual({
        path: 'Tests/HatsCoreTests/ProfileTests.swift',
        line: 8,
      });
    });

    it('makes absolute runner paths workspace-relative when the workspace is given', () => {
      const trace = `/Users/runner/work/hats/hats/Tests/HatsCoreTests/ProfileTests.swift:12: error: failed`;

      expect(parseFileLocation(trace, '/Users/runner/work/hats/hats')).toEqual({
        path: 'Tests/HatsCoreTests/ProfileTests.swift',
        line: 12,
      });
    });

    it('reads JS frames that have a line prefix', () => {
      const location = { path: 'src/a.test.ts', line: 3 };
      expect(parseFileLocation('\u001b[90m    at foo (src/a.test.ts:3:5)')).toEqual(location);
      expect(parseFileLocation('E    at foo (src/a.test.ts:3:5)')).toEqual(location);
    });

    it('reads JS frames with spaces in a parenthesised path', () => {
      expect(parseFileLocation('at foo (src/my app/a.test.js:3:5)')).toEqual({
        path: 'src/my app/a.test.js',
        line: 3,
      });
    });

    it('does not read times or addresses at the start of a line as a location', () => {
      expect(parseFileLocation('Request failed\nat 20:12:40')).toBeNull();
      expect(parseFileLocation('  at 2026-11-02 20:12:40.192')).toBeNull();
      expect(parseFileLocation(' at 127.0.0.1:8080:1')).toBeNull();
    });

    it.each([
      ['an unbroken path-like run', 'a'.repeat(200_000)],
      ['a long run of whitespace after at', `at ${' '.repeat(200_000)}`],
      ['many at tokens', 'at '.repeat(70_000)],
    ])('stays fast on %s', (_name, line) => {
      const started = performance.now();
      expect(parseFileLocation(line)).toBeNull();
      expect(performance.now() - started).toBeLessThan(500);
    });

    it('does not read a timestamp in a failure message as a location', () => {
      expect(parseFileLocation('Timed out at 2026-11-02 20:12:40.192')).toBeNull();
      expect(parseFileLocation('Connection dropped at 20:12:40')).toBeNull();
    });

    it('finds the location in output captured by --experimental-xunit-message-failure', () => {
      const message = `Test Suite 'Selected tests' started at 2026-11-02 20:12:40.192
Test Suite 'XCFirstTests' started at 2026-11-02 20:12:40.194
Test Case 'XCFirstTests.testFails' started at 2026-11-02 20:12:40.194
/work/detail/Tests/ProbeTests/XCTestTests.swift:6: error: XCFirstTests.testFails : XCTAssertEqual failed: ("42") is not equal to ("1") - wrong → answer
Test Case 'XCFirstTests.testFails' failed (0.001 seconds)`;

      expect(parseFileLocation(message, '/work/detail')).toEqual({
        path: 'Tests/ProbeTests/XCTestTests.swift',
        line: 6,
      });
    });

    it('keeps the whole file name for Swift naming conventions', () => {
      const workspace = '/Users/runner/work/app/app';
      expect(
        parseFileLocation(
          `${workspace}/Tests/String+ExtensionsTests.swift:12: error: x`,
          workspace,
        ),
      ).toEqual({ path: 'Tests/String+ExtensionsTests.swift', line: 12 });
      expect(parseFileLocation(`Tests/Foo@2x.swift:3: failed`)).toEqual({
        path: 'Tests/Foo@2x.swift',
        line: 3,
      });
    });

    it('handles spaces in the workspace and in the path of an error line', () => {
      const workspace = '/Users/runner/work/my app/my app';
      expect(parseFileLocation(`${workspace}/Tests/A.swift:3: error: x`, workspace)).toEqual({
        path: 'Tests/A.swift',
        line: 3,
      });
      expect(parseFileLocation(`${workspace}/My Tests/A.swift:3: error: x`, workspace)).toEqual({
        path: 'My Tests/A.swift',
        line: 3,
      });
    });

    it('prefers the assertion line over earlier output and later mentions', () => {
      const workspace = '/w/app';
      expect(
        parseFileLocation(
          `[info] Sources/App/Logger.swift:42 starting\n/w/app/Tests/A.swift:6: error: x`,
          workspace,
        ),
      ).toEqual({ path: 'Tests/A.swift', line: 6 });
      expect(parseFileLocation(`Tests/A.swift:6: error: expected main.go:12`)).toEqual({
        path: 'Tests/A.swift',
        line: 6,
      });
    });

    it('treats an absolute path outside the workspace as no location', () => {
      expect(parseFileLocation('/work/Tests/A.swift:3: error: x', '/home/runner/app')).toBeNull();
    });

    it('does not treat the workspace path itself as dependency code', () => {
      const vendor = '/home/runner/work/vendor/vendor';
      expect(parseFileLocation(`${vendor}/Tests/A.swift:3: error: x`, vendor)).toEqual({
        path: 'Tests/A.swift',
        line: 3,
      });
      const build = '/srv/ci.build/_work/app/app';
      expect(parseFileLocation(`${build}/Tests/A.swift:3: error: x`, build)).toEqual({
        path: 'Tests/A.swift',
        line: 3,
      });
    });

    it('matches dependency directories as whole path segments', () => {
      expect(parseFileLocation('acme-vendor/Tests/A.swift:3: error: x')).toEqual({
        path: 'acme-vendor/Tests/A.swift',
        line: 3,
      });
    });

    it('applies Swift dependency directories only to Swift files', () => {
      expect(parseFileLocation('at foo (.build/tests/a.test.js:3:5)')).toEqual({
        path: '.build/tests/a.test.js',
        line: 3,
      });
      expect(parseFileLocation('out.build/pkg/a_test.go:3')).toEqual({
        path: 'out.build/pkg/a_test.go',
        line: 3,
      });
    });

    it('makes Windows paths workspace-relative', () => {
      expect(
        parseFileLocation('D:\\a\\app\\app\\Tests\\A.swift:12: error: x', 'D:\\a\\app\\app'),
      ).toEqual({ path: 'Tests/A.swift', line: 12 });
    });

    it('ignores line numbers GitHub would reject', () => {
      expect(parseFileLocation('Tests/A.swift:0: error: x')).toBeNull();
      expect(parseFileLocation('Tests/A.swift:99999999999: error: x')).toBeNull();
    });

    it('skips SwiftPM checkouts and toolchain frames', () => {
      const trace = `/Users/runner/work/hats/hats/.build/checkouts/swift-argument-parser/Sources/ArgumentParser/Parsing.swift:40: error: boom
/Applications/Xcode_27.1.app/Contents/Developer/Platforms/MacOSX.platform/usr/lib/swift/Foo.swift:9: error: boom
Tests/HatsE2ETests/RunCommandTests.swift:21: error: exit code was 1`;

      expect(parseFileLocation(trace, '/Users/runner/work/hats/hats')).toEqual({
        path: 'Tests/HatsE2ETests/RunCommandTests.swift',
        line: 21,
      });
    });
  });

  describe('dependency filtering of Swift package checkouts', () => {
    it('skips Xcode SourcePackages checkouts', () => {
      const trace = `/Users/me/DerivedData/App/SourcePackages/checkouts/lib/Sources/Lib.swift:4: error: boom
Tests/AppTests/LoginTests.swift:9: error: failed`;

      expect(parseFileLocation(trace)).toEqual({
        path: 'Tests/AppTests/LoginTests.swift',
        line: 9,
      });
    });

    it('keeps project code in a directory that happens to be called checkouts', () => {
      const trace = `Error: fail
    at Object.<anonymous> (src/checkouts/cart.test.ts:7:1)`;

      expect(parseFileLocation(trace)).toEqual({ path: 'src/checkouts/cart.test.ts', line: 7 });
    });
  });

  describe('dependency filtering', () => {
    it('skips node_modules frames and returns next valid frame', () => {
      const trace = `Error: fail
    at Object.<anonymous> (node_modules/jest-runner/build/index.js:10:5)
    at myTest (src/app.test.ts:25:3)`;

      expect(parseFileLocation(trace)).toEqual({ path: 'src/app.test.ts', line: 25 });
    });

    it('skips site-packages frames', () => {
      const trace = `Traceback (most recent call last):
  File "/usr/lib/python3/site-packages/pytest/runner.py", line 100, in call
    item.runtest()
  File "tests/test_api.py", line 55, in test_endpoint
    assert response.status == 200`;

      expect(parseFileLocation(trace)).toEqual({ path: 'tests/test_api.py', line: 55 });
    });

    it('skips vendor/ frames', () => {
      const trace = `--- FAIL: TestSomething (0.00s)
    vendor/github.com/stretchr/testify/assert.go:100: unexpected
    internal/handler_test.go:30: handler failed`;

      expect(parseFileLocation(trace)).toEqual({ path: 'internal/handler_test.go', line: 30 });
    });
  });

  describe('path normalization', () => {
    it('strips leading ./ from paths', () => {
      const trace = `Error: fail
    at Object.<anonymous> (./src/foo.test.ts:10:1)`;

      expect(parseFileLocation(trace)).toEqual({ path: 'src/foo.test.ts', line: 10 });
    });

    it('strips leading / from absolute paths', () => {
      const trace = `Error: fail
    at Object.<anonymous> (/workspace/src/foo.test.ts:10:1)`;

      expect(parseFileLocation(trace)).toEqual({ path: 'workspace/src/foo.test.ts', line: 10 });
    });
  });

  describe('edge cases', () => {
    it('returns null for empty string', () => {
      expect(parseFileLocation('')).toBeNull();
    });

    it('returns null for undefined', () => {
      expect(parseFileLocation(undefined as unknown as string)).toBeNull();
    });

    it('returns null when no recognizable pattern found', () => {
      const trace = `Some random error output with no file references`;
      expect(parseFileLocation(trace)).toBeNull();
    });

    it('returns null when only dependency frames exist', () => {
      const trace = `Error: fail
    at Object.<anonymous> (node_modules/some-lib/index.js:5:3)
    at node_modules/another-lib/runner.js:10:1`;

      expect(parseFileLocation(trace)).toBeNull();
    });
  });
});

describe('normalizePath', () => {
  it('strips a Windows workspace from a forward-slash path', () => {
    expect(normalizePath('D:/a/app/app/test-results/junit.xml', 'D:\\a\\app\\app')).toBe(
      'test-results/junit.xml',
    );
  });
});

describe('location parsing hardening', () => {
  it.each([
    ['payments.internal:8080: error: connection refused'],
    ['127.0.0.1:5432: error: FATAL'],
  ])('does not read a host and port as a diagnostic path: %s', (message) => {
    expect(parseFailureMessageLocation(message)).toBeNull();
    expect(parseFileLocation(message)).toBeNull();
  });

  it('does not read prose before a path as part of the path', () => {
    const message = 'Build failed in Tests/A.swift:3: error: x';
    expect(parseFailureMessageLocation(message)).toBeNull();
    expect(parseFileLocation(message)).toEqual({ path: 'Tests/A.swift', line: 3 });
  });

  it('accepts a bare source file on a diagnostic line', () => {
    expect(parseFailureMessageLocation('A.swift:3: error: x')).toEqual({
      path: 'A.swift',
      line: 3,
    });
  });

  it('reads file:// frames as paths', () => {
    const workspace = '/home/runner/work/app/app';
    expect(parseFileLocation(`at t (file://${workspace}/test/a.test.mjs:3:5)`, workspace)).toEqual({
      path: 'test/a.test.mjs',
      line: 3,
    });
  });

  it('skips a file:// frame outside the workspace for a later frame', () => {
    const workspace = '/w/app';
    const trace = `at file:///usr/lib/x.mjs:3:5\nat t (${workspace}/test/a.mjs:7:1)`;
    expect(parseFileLocation(trace, workspace)).toEqual({ path: 'test/a.mjs', line: 7 });
  });

  it('removes the workspace only where a path starts', () => {
    expect(parseFileLocation('/mnt/w/app/Tests/A.swift:3: error: x', '/w/app')).toBeNull();
    const inner = 'bazel-out/sandbox/home/runner/work/app/app/pkg/x.go';
    expect(parseFileLocation(`${inner}:3`, '/home/runner/work/app/app')?.path).toBe(inner);
  });

  it('reads a bare JS frame with a space in its path', () => {
    expect(parseFileLocation('at my dir/a.js:3:5')).toEqual({ path: 'my dir/a.js', line: 3 });
  });

  it('reads a JS frame directly after an ANSI color code', () => {
    expect(parseFileLocation('\u001b[90mat foo (src/a.ts:3:5)')).toEqual({
      path: 'src/a.ts',
      line: 3,
    });
  });

  it('does not read a hostname as a JS frame', () => {
    expect(parseFileLocation('at api.example.com:443:1')).toBeNull();
  });

  it('stays fast on a large body of long lines', () => {
    const body = `${'a'.repeat(1000)}\n`.repeat(10_000);
    const started = performance.now();
    expect(parseFileLocation(body)).toBeNull();
    expect(performance.now() - started).toBeLessThan(500);
  });

  it('stops scanning after a bounded number of lines', () => {
    const trace = `${'noise\n'.repeat(5000)}Tests/A.swift:3: error: x`;
    expect(parseFileLocation(trace)).toBeNull();
  });
});

describe('isRepoFile', () => {
  it('accepts a relative path and a path in the workspace', () => {
    expect(isRepoFile('test/a.py', '/w/app')).toBe(true);
    expect(isRepoFile('/w/app/test/a.py', '/w/app')).toBe(true);
  });

  it('rejects an absolute path outside the workspace', () => {
    expect(isRepoFile('/usr/src/app/test/a.py', '/w/app')).toBe(false);
  });

  it('rejects dependency code', () => {
    expect(isRepoFile('node_modules/x/a.js', '/w/app')).toBe(false);
  });
});
