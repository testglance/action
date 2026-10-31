import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseJunitXml } from '../../parsers/junit';
import { parseFileLocation } from '../parse-stack-trace';

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
