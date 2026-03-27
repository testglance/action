# JUnit 5 (Maven & Gradle)

Step-by-step guide to configure JUnit 5 with TestGlance for GitHub Actions.

## Prerequisites

- Maven or Gradle project with JUnit 5 tests
- A GitHub Actions workflow that runs your tests

## Maven

Maven Surefire generates JUnit XML reports automatically — no configuration needed.

Reports are written to `target/surefire-reports/TEST-*.xml`.

### GitHub Actions

```yaml
steps:
  - uses: actions/checkout@v4

  - name: Set up JDK
    uses: actions/setup-java@v4
    with:
      distribution: temurin
      java-version: 21

  - name: Run tests
    run: mvn test

  - name: TestGlance
    if: always()
    uses: testglance/action@v1
    with:
      api-key: ${{ secrets.TESTGLANCE_API_KEY }}
```

TestGlance auto-detects `**/surefire-reports/*.xml` — no `report-path` needed.

## Gradle

Enable JUnit XML reports in `build.gradle.kts`:

```kotlin
tasks.test {
    useJUnitPlatform()
    reports {
        junitXml.required.set(true)
    }
}
```

Reports are written to `build/test-results/test/*.xml`.

### GitHub Actions

```yaml
steps:
  - uses: actions/checkout@v4

  - name: Set up JDK
    uses: actions/setup-java@v4
    with:
      distribution: temurin
      java-version: 21

  - name: Run tests
    run: ./gradlew test

  - name: TestGlance
    if: always()
    uses: testglance/action@v1
    with:
      api-key: ${{ secrets.TESTGLANCE_API_KEY }}
```

`if: always()` ensures TestGlance runs even when tests fail.

TestGlance auto-detects `**/test-results/**/*.xml` — no `report-path` needed.

<details>
<summary>Standalone mode (no SaaS)</summary>

```yaml
- name: TestGlance
  if: always()
  uses: testglance/action@v1
  with:
    api-key: unused
    send-results: false
```

</details>
