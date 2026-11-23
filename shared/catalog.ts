type Department = { id: string; name: string };
type CatalogTable = {
  id: string;
  name: string;
  department_id: string;
  columns: { id: string; name: string }[];
};

// Input must be the server-authorized projection, including visible columns only.
export function filterCatalog<D extends Department, T extends CatalogTable>(
  departments: D[],
  tables: T[],
  search: string,
) {
  const query = search.trim().toLocaleLowerCase();
  const matches = (value: string) => value.toLocaleLowerCase().includes(query);
  return departments
    .map((department) => {
      const departmentMatches = matches(department.name);
      const children = tables.filter(
        (table) =>
          table.department_id === department.id &&
          (!query ||
            departmentMatches ||
            matches(table.name) ||
            table.columns.some(
              (field) => matches(field.name) || matches(field.id),
            )),
      );
      return { department, tables: children };
    })
    .filter(
      (group) =>
        !query || matches(group.department.name) || group.tables.length > 0,
    );
}
