import { DependencyResolver } from "./dependency-resolver";

describe("DependencyResolver", () => {
  describe("resolveExecutionOrder", () => {
    it("should handle entities with no dependencies", () => {
      const entities = ["users", "products", "orders"];
      const dependencies = {};
      const resolver = new DependencyResolver(entities, dependencies);

      const waves = resolver.resolveExecutionOrder();

      expect(waves).toHaveLength(1);
      expect(waves[0].wave).toBe(0);
      expect(waves[0].entities).toEqual(["users", "products", "orders"]);
    });

    it("should resolve simple linear dependencies", () => {
      const entities = ["users", "products", "orders"];
      const dependencies = {
        products: ["users"],
        orders: ["products"],
      };
      const resolver = new DependencyResolver(entities, dependencies);

      const waves = resolver.resolveExecutionOrder();

      expect(waves).toHaveLength(3);
      expect(waves[0].entities).toEqual(["users"]);
      expect(waves[1].entities).toEqual(["products"]);
      expect(waves[2].entities).toEqual(["orders"]);
    });

    it("should resolve complex dependency graph", () => {
      const entities = ["users", "categories", "products", "orders", "reviews"];
      const dependencies = {
        products: ["users", "categories"],
        orders: ["users", "products"],
        reviews: ["users", "products"],
      };
      const resolver = new DependencyResolver(entities, dependencies);

      const waves = resolver.resolveExecutionOrder();

      expect(waves).toHaveLength(3);

      // Wave 0: users and categories (no dependencies)
      expect(waves[0].entities.sort()).toEqual(["categories", "users"]);

      // Wave 1: products (depends on users and categories)
      expect(waves[1].entities).toEqual(["products"]);

      // Wave 2: orders and reviews (both depend on users and products)
      expect(waves[2].entities.sort()).toEqual(["orders", "reviews"]);
    });

    it("should handle entities with multiple dependencies", () => {
      const entities = ["a", "b", "c", "d"];
      const dependencies = {
        c: ["a", "b"],
        d: ["a", "b"],
      };
      const resolver = new DependencyResolver(entities, dependencies);

      const waves = resolver.resolveExecutionOrder();

      expect(waves).toHaveLength(2);
      expect(waves[0].entities.sort()).toEqual(["a", "b"]);
      expect(waves[1].entities.sort()).toEqual(["c", "d"]);
    });

    it("should detect circular dependencies", () => {
      const entities = ["a", "b", "c"];
      const dependencies = {
        a: ["b"],
        b: ["c"],
        c: ["a"], // circular
      };
      const resolver = new DependencyResolver(entities, dependencies);

      expect(() => resolver.resolveExecutionOrder()).toThrow(
        "Circular dependency detected or missing dependencies for entities: a, b, c",
      );
    });

    it("should detect missing dependencies", () => {
      const entities = ["a", "b"];
      const dependencies = {
        a: ["missing"],
        b: ["a"],
      };
      const resolver = new DependencyResolver(entities, dependencies, false);

      expect(() => resolver.resolveExecutionOrder()).toThrow(
        "Circular dependency detected or missing dependencies for entities: a, b",
      );
    });

    it("should allow entities with dependencies not in the entity list when partial resolution is enabled", () => {
      const entities = ["a", "b"];
      const dependencies = {
        a: ["missing"],
        b: ["a"],
      };
      const resolver = new DependencyResolver(entities, dependencies, true);

      const waves = resolver.resolveExecutionOrder();
      expect(waves).toHaveLength(2);
      expect(waves[0].entities).toEqual(["a"]);
      expect(waves[1].entities).toEqual(["b"]);
    });
  });

  describe("validateDependencies", () => {
    it("should return no errors for valid dependencies", () => {
      const entities = ["users", "products", "orders"];
      const dependencies = {
        products: ["users"],
        orders: ["users", "products"],
      };
      const resolver = new DependencyResolver(entities, dependencies);

      const errors = resolver.validateDependencies();

      expect(errors).toHaveLength(0);
    });

    it("should detect entity with dependencies not in entity list", () => {
      const entities = ["users", "products"];
      const dependencies = {
        products: ["users"],
        orders: ["products"], // orders not in entities list
      };
      const resolver = new DependencyResolver(entities, dependencies);

      const errors = resolver.validateDependencies();

      expect(errors).toContain("Entity 'orders' has dependencies but is not in the entity list");
    });

    it("should detect dependencies on non-existent entities", () => {
      const entities = ["users", "products"];
      const dependencies = {
        products: ["users", "categories"], // categories doesn't exist
      };
      const resolver = new DependencyResolver(entities, dependencies);

      const errors = resolver.validateDependencies();

      expect(errors).toContain("Entity 'products' depends on 'categories' which does not exist");
    });

    it("should detect multiple validation errors", () => {
      const entities = ["users"];
      const dependencies = {
        products: ["categories"], // products not in list, categories doesn't exist
        orders: ["missing"], // orders not in list, missing doesn't exist
      };
      const resolver = new DependencyResolver(entities, dependencies);

      const errors = resolver.validateDependencies();

      expect(errors).toHaveLength(2);
      expect(errors).toContain("Entity 'products' has dependencies but is not in the entity list");
      expect(errors).toContain("Entity 'orders' has dependencies but is not in the entity list");
    });
  });

  describe("getDependents", () => {
    it("should return entities that depend on the given entity", () => {
      const entities = ["users", "products", "orders", "reviews"];
      const dependencies = {
        products: ["users"],
        orders: ["users", "products"],
        reviews: ["users", "products"],
      };
      const resolver = new DependencyResolver(entities, dependencies);

      const usersDependents = resolver.getDependents("users");
      const productsDependents = resolver.getDependents("products");
      const ordersDependents = resolver.getDependents("orders");

      expect(usersDependents.sort()).toEqual(["orders", "products", "reviews"]);
      expect(productsDependents.sort()).toEqual(["orders", "reviews"]);
      expect(ordersDependents).toEqual([]);
    });
  });

  describe("getDependencies", () => {
    it("should return dependencies for the given entity", () => {
      const entities = ["users", "products", "orders"];
      const dependencies = {
        products: ["users"],
        orders: ["users", "products"],
      };
      const resolver = new DependencyResolver(entities, dependencies);

      expect(resolver.getDependencies("users")).toEqual([]);
      expect(resolver.getDependencies("products")).toEqual(["users"]);
      expect(resolver.getDependencies("orders")).toEqual(["users", "products"]);
      expect(resolver.getDependencies("nonexistent")).toEqual([]);
    });
  });
});
