export { DataReader, DataRow, DataReaderFactory } from "./data-reader";
export { CsvReader } from "./csv";
export { JsonReader } from "./json";
export { YamlReader } from "./yaml";
export { JsonlReader } from "./jsonl";

// Register all readers
import { DataReaderFactory } from "./data-reader";
import { CsvReader } from "./csv";
import { JsonReader } from "./json";
import { YamlReader } from "./yaml";
import { JsonlReader } from "./jsonl";

// Register readers on module load
DataReaderFactory.registerReader(new CsvReader());
DataReaderFactory.registerReader(new JsonReader());
DataReaderFactory.registerReader(new YamlReader());
DataReaderFactory.registerReader(new JsonlReader());
