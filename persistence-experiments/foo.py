
def get(

@get("/info")
def info(req, resp):
  resp.write("hello")
