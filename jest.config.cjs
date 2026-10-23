module.exports = {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        useESM: true,
      },
    ],
  },
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  testMatch: ["<rootDir>/__tests__/**/*.test.[jt]s"],
  testPathIgnorePatterns: ["<rootDir>/dist/", "<rootDir>/tests/"],
  modulePathIgnorePatterns: ["<rootDir>/dist/"]
};
