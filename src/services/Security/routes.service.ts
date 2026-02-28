import { AppDataSource } from "../../database/connection";
import { SecModule } from "../../entity/Security/secmodule.entity";
import { ensureCorrectSchemaOnQueryRunner } from "../../database/TypeORMTenantInterceptor";

/**
 * Routes Service
 * Handles dynamic route fetching and management from SEC_MODULE_DATA
 */
export class RoutesService {
  /**
   * Get all active routes for the current tenant
   * Filters by IS_ACTIVE = 'Y' and organizes by hierarchy
   */
  static async getAllRoutes(tenantId?: string): Promise<any[]> {
    const queryRunner = AppDataSource.createQueryRunner();
    await ensureCorrectSchemaOnQueryRunner(queryRunner);
    await queryRunner.connect();

    try {
      const routes = await queryRunner.manager.find(SecModule, {
        where: {
          is_active: 'Y',
        },
        // order by app_code, level1, level2, level3, sort_order
        order: {
          app_code: 'ASC',
          level1: 'ASC',
          level2: 'ASC',
          level3: 'ASC',
          sort_order: 'ASC',
        },
      });

      return routes.map(route => this.formatRoute(route));
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Get routes by application code
   */
  static async getRoutesByAppCode(appCode: string): Promise<any[]> {
    const queryRunner = AppDataSource.createQueryRunner();
    await ensureCorrectSchemaOnQueryRunner(queryRunner);
    await queryRunner.connect();

    try {
      const routes = await queryRunner.manager.find(SecModule, {
        where: {
          app_code: appCode,
          is_active: 'Y',
        },
        order: {
          level1: 'ASC',
          level2: 'ASC',
          level3: 'ASC',
          sort_order: 'ASC',
        },
      });

      return routes.map(route => this.formatRoute(route));
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Get a specific route by URL path
   */
  static async getRouteByPath(urlPath: string): Promise<any | null> {
    const queryRunner = AppDataSource.createQueryRunner();
    await ensureCorrectSchemaOnQueryRunner(queryRunner);
    await queryRunner.connect();

    try {
      const route = await queryRunner.manager.findOne(SecModule, {
        where: {
          url_path: urlPath,
          is_active: 'Y',
        },
      });

      return route ? this.formatRoute(route) : null;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Get a specific route by serial number
   */
  static async getRouteBySerialNo(serialNo: number): Promise<any | null> {
    const queryRunner = AppDataSource.createQueryRunner();
    await ensureCorrectSchemaOnQueryRunner(queryRunner);
    await queryRunner.connect();

    try {
      const route = await queryRunner.manager.findOne(SecModule, {
        where: {
          serial_no: serialNo,
          is_active: 'Y',
        },
      });

      return route ? this.formatRoute(route) : null;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Build a hierarchical tree structure from flat routes
   * Used by frontend to render dynamic navigation
   */
  static buildRouteTree(routes: any[]): any {
    const tree: Record<string, any> = {};

    routes.forEach(route => {
      const { app_code, level1, level2, level3 } = route;

      // Initialize app
      if (!tree[app_code]) {
        tree[app_code] = {
          id: `${app_code}`,
          title: app_code,
          type: 'collapse',
          children: [],
          ...route, // Include all route data at app level
        };
      }

      // If we have level1
      if (level1 && level1.trim()) {
        let level1Node = tree[app_code].children.find(
          (n: any) => n.title === level1
        );

        if (!level1Node) {
          level1Node = {
            id: `${app_code}_${level1}`,
            title: level1,
            type: level2 ? 'group' : 'item',
            children: [],
            ...route,
          };
          tree[app_code].children.push(level1Node);
        }

        // If we have level2
        if (level2 && level2.trim()) {
          let level2Node = level1Node.children?.find(
            (n: any) => n.title === level2
          );

          if (!level2Node) {
            level2Node = {
              id: `${app_code}_${level1}_${level2}`,
              title: level2,
              type: level3 ? 'collapse' : 'item',
              children: [],
              ...route,
            };
            if (!level1Node.children) level1Node.children = [];
            level1Node.children.push(level2Node);
          }

          // If we have level3
          if (level3 && level3.trim()) {
            let level3Node = level2Node.children?.find(
              (n: any) => n.title === level3
            );

            if (!level3Node) {
              level3Node = {
                id: `${app_code}_${level1}_${level2}_${level3}`,
                title: level3,
                type: 'item',
                ...route,
              };
              if (!level2Node.children) level2Node.children = [];
              level2Node.children.push(level3Node);
            }
          }
        }
      }
    });

    return Object.values(tree);
  }

  /**
   * Format a single route for API response
   */
  private static formatRoute(route: SecModule): any {
    return {
      serial_no: route.serial_no,
      company_code: route.company_code,
      app_code: route.app_code,
      level1: route.level1 || null,
      level2: route.level2 || null,
      level3: route.level3 || null,
      url_path: route.url_path || null,
      component_name: route.component_name || null,
      route_type: route.route_type || 'INTERNAL',
      is_active: route.is_active || 'Y',
      description: route.description || null,
      sort_order: route.sort_order || 999,
      icon: route.icon || null,
      icon_name: route.icon_name || null,
      created_at: route.created_at,
      updated_at: route.updated_at,
    };
  }

  /**
   * Create or update a route
   */
  static async saveRoute(routeData: any): Promise<SecModule> {
    const queryRunner = AppDataSource.createQueryRunner();
    await ensureCorrectSchemaOnQueryRunner(queryRunner);
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const route = new SecModule();
      
      // Assign properties
      Object.assign(route, {
        company_code: routeData.company_code,
        app_code: routeData.app_code,
        level1: routeData.level1 || null,
        level2: routeData.level2 || null,
        level3: routeData.level3 || null,
        url_path: routeData.url_path,
        component_name: routeData.component_name || null,
        is_active: routeData.is_active || 'Y',
        route_type: routeData.route_type || 'INTERNAL',
        description: routeData.description || null,
        sort_order: routeData.sort_order || 999,
        icon: routeData.icon || null,
        icon_name: routeData.icon_name || null,
        created_by: routeData.created_by || 'SYSTEM',
        updated_by: routeData.updated_by || 'SYSTEM',
      });

      const saved = await queryRunner.manager.save(route);
      await queryRunner.commitTransaction();
      return saved;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Deactivate a route (soft delete)
   */
  static async deactivateRoute(serialNo: number): Promise<boolean> {
    const queryRunner = AppDataSource.createQueryRunner();
    await ensureCorrectSchemaOnQueryRunner(queryRunner);
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const result = await queryRunner.manager.update(
        SecModule,
        { serial_no: serialNo },
        { is_active: 'N' }
      );

      await queryRunner.commitTransaction();
      return result.affected ? result.affected > 0 : false;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}
