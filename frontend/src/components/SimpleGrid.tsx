import { AgGridReact } from "ag-grid-react";
import { themeQuartz } from "ag-grid-community";
import { useEffect, useMemo, useRef, useState } from "react";
import { useResponsive } from "../hooks/useResponsive";

function setQuickFilter(api, value) {
  if (!api) return;
  if (typeof api.setQuickFilter === "function") {
    api.setQuickFilter(value);
    return;
  }
  if (typeof api.setGridOption === "function") {
    api.setGridOption("quickFilterText", value);
  }
}

export default function SimpleGrid({
  rows,
  columns,
  height = 240,
  onRowClick,
  enableQuickFilter = false,
  quickFilterPlaceholder = "Search...",
  pagination = false,
  pageSize = 200,
  getRowId,
  getRowStyle,
  rowSelection = "single",
  paginationPageSizeSelector = [20, 50, 100, 200]
}: any) {
  const { isMobile } = useResponsive();
  const gridApiRef = useRef<any>(null);
  const [q, setQ] = useState("");

  const defaultColDef = useMemo(() => ({
    resizable: true,
    sortable: true,
    filter: !isMobile,
    floatingFilter: !isMobile,
    minWidth: isMobile ? 60 : 80
  }), [isMobile]);

  useEffect(() => {
    setQuickFilter(gridApiRef.current, q);
  }, [q]);

  return (
    <div style={{ width: "100%" }}>
      {enableQuickFilter && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8 }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={quickFilterPlaceholder}
            style={{
              width: "100%",
              padding: isMobile ? "12px 14px" : "10px 12px",
              fontSize: isMobile ? 15 : undefined,
              borderRadius: 12,
              border: "1px solid #e2e8f0",
              outline: "none"
            }}
          />
        </div>
      )}
      <div style={{ height, width: "100%", borderRadius: 16, overflow: "hidden" }}>
        <AgGridReact<any>
          theme={themeQuartz}
          rowData={rows}
          columnDefs={columns}
          defaultColDef={defaultColDef}
          animateRows
          rowSelection={{ mode: rowSelection === "multiple" ? "multiRow" : "singleRow" }}
          pagination={pagination}
          paginationPageSize={pageSize}
          paginationPageSizeSelector={paginationPageSizeSelector}
          getRowId={getRowId}
          getRowStyle={getRowStyle}
          onGridReady={(e) => {
            gridApiRef.current = e.api;
            setQuickFilter(e.api, q);
            // A nice default for dashboards.
            e.api.sizeColumnsToFit?.();
          }}
          onRowClicked={(e) => onRowClick?.(e.data)}
        />
      </div>
    </div>
  );
}
