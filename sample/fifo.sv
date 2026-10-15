// A small synchronous FIFO, written the way RTL usually is.
// Used to exercise hover, completion and go-to-definition against real code.
module fifo #(
  parameter int WIDTH = 8,
  parameter int DEPTH = 16
) (
  input  wire              clk,
  input  wire              rst_n,
  input  wire              push,
  input  wire              pop,
  input  wire [WIDTH-1:0]  din,
  output logic             full,
  output logic             empty,
  output logic [WIDTH-1:0] dout
);

  // Depth must be a power of two for this pointer scheme.
  localparam int AW = $clog2(DEPTH);

  logic [WIDTH-1:0] mem [DEPTH-1:0];
  logic [AW-1:0]   wptr;
  logic [AW-1:0]   rptr;

  assign full  = (wptr[AW-1] != rptr[AW-1]) && (wptr[AW-2:0] == rptr[AW-2:0]);
  assign empty = (wptr == rptr);
  assign dout  = mem[rptr];

  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
      wptr <= '0;
      rptr <= '0;
    end else begin
      if (push && !full) begin
        mem[wptr] <= din;
        wptr <= wptr + 1'b1;
      end
      if (pop && !empty) begin
        rptr <= rptr + 1'b1;
      end
    end
  end

endmodule