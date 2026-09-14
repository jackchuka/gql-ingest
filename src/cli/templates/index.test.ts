import fs from "fs";
import os from "os";
import path from "path";
import * as yaml from "js-yaml";
import {
  generateConfigYaml,
  generateEntityFiles,
  generateExampleEntity,
  isDataFormat,
  toPascalCase,
  validateEntityName,
  ensureDirectories,
  DataFormat,
} from "./index";
import { Logger } from "../../lib/logger";
import {
  CONFIG_TEMPLATE,
  DEFAULT_PARALLEL_CONFIG,
  DEFAULT_RETRY_CONFIG,
} from "../../lib/config-schema";

describe("templates", () => {
  let tmpDir: string;
  let mockLogger: jest.Mocked<Logger>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gql-ingest-templates-"));
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    jest.clearAllMocks();
  });

  const readConfig = () => fs.readFileSync(path.join(tmpDir, "config.yaml"), "utf-8");

  describe("generateConfigYaml", () => {
    it("should write a config.yaml that parses as YAML with defaults applied", async () => {
      await generateConfigYaml(tmpDir, false, mockLogger);

      const parsed = yaml.load(readConfig()) as Record<string, unknown>;

      expect(parsed.parallelProcessing).toEqual(DEFAULT_PARALLEL_CONFIG);
      expect(parsed.retry).toEqual(DEFAULT_RETRY_CONFIG);
      expect(parsed.entityConfig).toEqual({});
      expect(parsed.entityDependencies).toEqual({});
      expect(mockLogger.info).toHaveBeenCalledWith("Created config.yaml");
    });

    // Guards the only runtime dependency this project has on zod: the generator reads
    // `.shape[key].description` off the schemas. A zod upgrade that changes either would
    // silently drop every comment from the generated file.
    it("should emit every schema description as a comment", async () => {
      await generateConfigYaml(tmpDir, false, mockLogger);
      const content = readConfig();

      const sections = [
        CONFIG_TEMPLATE.schema.parallelProcessing.shape,
        CONFIG_TEMPLATE.schema.retry.shape,
      ];

      for (const shape of sections) {
        for (const field of Object.values(shape)) {
          expect(field.description).toBeTruthy();
          expect(content).toContain(`  # ${field.description}`);
        }
      }

      expect(content).toContain(`# ${CONFIG_TEMPLATE.schema.entityConfig.description}`);
      expect(content).toContain(`# ${CONFIG_TEMPLATE.schema.entityDependencies.description}`);
    });

    it("should emit commented examples that parse back as YAML", async () => {
      await generateConfigYaml(tmpDir, false, mockLogger);
      const lines = readConfig().split("\n");

      const uncomment = (startsWith: string) => {
        const start = lines.findIndex((l) => l.startsWith(`# ${startsWith}:`));
        expect(start).toBeGreaterThan(-1);
        const block: string[] = [];
        for (let i = start; i < lines.length && lines[i].startsWith("# "); i++) {
          block.push(lines[i].slice(2));
        }
        return yaml.load(block.join("\n")) as Record<string, unknown>;
      };

      expect(uncomment("entityConfig").entityConfig).toEqual(CONFIG_TEMPLATE.examples.entityConfig);
      expect(uncomment("entityDependencies").entityDependencies).toEqual(
        CONFIG_TEMPLATE.examples.entityDependencies,
      );
    });

    it("should skip an existing config.yaml unless forced", async () => {
      const configPath = path.join(tmpDir, "config.yaml");
      fs.writeFileSync(configPath, "existing", "utf-8");

      await generateConfigYaml(tmpDir, false, mockLogger);

      expect(fs.readFileSync(configPath, "utf-8")).toBe("existing");
      expect(mockLogger.warn).toHaveBeenCalledWith(
        "config.yaml already exists, skipping (use --force to overwrite)",
      );

      await generateConfigYaml(tmpDir, true, mockLogger);

      expect(fs.readFileSync(configPath, "utf-8")).not.toBe("existing");
    });
  });

  describe("generateEntityFiles", () => {
    const options = {
      format: "csv" as DataFormat,
      fields: ["id", "name"],
      mutationName: "CreateUser",
    };
    const read = (entity: string, file: string) =>
      fs.readFileSync(path.join(tmpDir, entity, file), "utf-8");

    it("should create the entity directory and its three files", async () => {
      await generateEntityFiles(tmpDir, "users", options, mockLogger);

      expect(fs.readdirSync(path.join(tmpDir, "users")).sort()).toEqual([
        "entity.json",
        "users.csv",
        "users.graphql",
      ]);
      expect(mockLogger.info).toHaveBeenCalledWith("Created directory: users/");
    });

    it("should write an entity.json describing the generated files", async () => {
      await generateEntityFiles(tmpDir, "users", options, mockLogger);

      expect(JSON.parse(read("users", "entity.json"))).toEqual({
        name: "users",
        dataFile: "users.csv",
        dataFormat: "csv",
        graphqlFile: "users.graphql",
        mapping: { id: "id", name: "name" },
      });
    });

    it("should write a mutation whose response omits the always-included id", async () => {
      await generateEntityFiles(tmpDir, "users", options, mockLogger);

      expect(read("users", "users.graphql")).toBe(
        `mutation CreateUser($id: String!, $name: String!) {
  createUser(input: { id: $id, name: $name }) {
    id
    name
  }
}
`,
      );
    });

    it.each([
      ["csv", (s: string) => expect(s).toBe("id,name\nsample_id_1,sample_name_2")],
      [
        "json",
        (s: string) =>
          expect(JSON.parse(s)).toEqual([{ id: "sample_id_1", name: "sample_name_2" }]),
      ],
      [
        "yaml",
        (s: string) => expect(yaml.load(s)).toEqual([{ id: "sample_id_1", name: "sample_name_2" }]),
      ],
      [
        "jsonl",
        (s: string) => expect(JSON.parse(s)).toEqual({ id: "sample_id_1", name: "sample_name_2" }),
      ],
    ] as const)("should write sample data for %s", async (format, assert) => {
      await generateEntityFiles(tmpDir, "users", { ...options, format }, mockLogger);

      assert(read("users", `users.${format}`));
    });

    it("should skip existing files unless forced", async () => {
      await generateEntityFiles(tmpDir, "users", options, mockLogger);
      const dataPath = path.join(tmpDir, "users", "users.csv");
      fs.writeFileSync(dataPath, "edited", "utf-8");

      await generateEntityFiles(tmpDir, "users", options, mockLogger);

      expect(fs.readFileSync(dataPath, "utf-8")).toBe("edited");
      expect(mockLogger.warn).toHaveBeenCalledWith("users/users.csv already exists, skipping");

      await generateEntityFiles(tmpDir, "users", options, mockLogger, true);

      expect(fs.readFileSync(dataPath, "utf-8")).toBe("id,name\nsample_id_1,sample_name_2");
    });
  });

  describe("generateExampleEntity", () => {
    it("should create an example entity with a CreateUser mutation", async () => {
      await generateExampleEntity(tmpDir, false, mockLogger);

      const entityDef = JSON.parse(
        fs.readFileSync(path.join(tmpDir, "example", "entity.json"), "utf-8"),
      );
      expect(entityDef.name).toBe("example");
      expect(entityDef.mapping).toEqual({ id: "id", name: "name", email: "email" });
      expect(fs.readFileSync(path.join(tmpDir, "example", "example.graphql"), "utf-8")).toContain(
        "mutation CreateUser(",
      );
    });

    it("should honour the requested data format", async () => {
      await generateExampleEntity(tmpDir, false, mockLogger, "jsonl");

      expect(fs.existsSync(path.join(tmpDir, "example", "example.jsonl"))).toBe(true);
    });
  });

  describe("ensureDirectories", () => {
    it("should create the base path when missing and be idempotent", () => {
      const nested = path.join(tmpDir, "a", "b");

      ensureDirectories(nested, mockLogger);
      ensureDirectories(nested, mockLogger);

      expect(fs.statSync(nested).isDirectory()).toBe(true);
    });
  });

  describe("isDataFormat", () => {
    it.each(["csv", "json", "yaml", "jsonl"])("should accept %s", (format) => {
      expect(isDataFormat(format)).toBe(true);
    });

    it.each(["", "CSV", "xml", "tsv"])("should reject %s", (format) => {
      expect(isDataFormat(format)).toBe(false);
    });
  });

  describe("validateEntityName", () => {
    it.each(["users", "u", "user_profiles", "user-profiles", "a1"])("should accept %s", (name) => {
      expect(validateEntityName(name)).toBe(true);
    });

    it.each(["", "1users", "_users", "-users", "user profiles", "users!"])(
      "should reject %s",
      (name) => {
        expect(validateEntityName(name)).toBe(false);
      },
    );
  });

  describe("toPascalCase", () => {
    it.each([
      ["users", "Users"],
      ["user_profiles", "UserProfiles"],
      ["user-profiles", "UserProfiles"],
      ["USER_PROFILES", "UserProfiles"],
    ])("should convert %s to %s", (input, expected) => {
      expect(toPascalCase(input)).toBe(expected);
    });
  });
});
