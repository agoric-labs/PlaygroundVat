const e = require("express");

// mongoose for mongodb

e.get("/info", (req, resp) => {
  resp.write("hello");
});

e.get("/users/:name", (req, resp) => {
  resp.write(`hello {req.name}`);
});


e.get("/post-to/:name", (req, resp) => {
  
  resp.write(`hello {req.name}`);
});
