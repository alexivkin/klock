$(function() {
  Handlebars.registerHelper("debug", function(optionalValue) {
    console.log("Current Context");
    console.log(this);
    if (optionalValue) {
      console.log("Value");
      console.log(optionalValue);
    }
  });
  var eventsources={}

  var [engine,user]=document.URL.split('/').slice(-2)
  // console.log(engine)
  $('#engine').text(engine=='gh'?"GitHub":"Bitbucket")
  $('#user').text(user)
  // $('#server').text(server)
  // $('[data-toggle="tooltip"]').tooltip() - for static tooltips
  $("#check-all").click(()=>{
      $('input:checkbox[name=repomark]').prop('checked', true);
      // $('input:checkbox[name=repomark]').not(this).prop('checked', this.checked);
  });
  $("#uncheck-all").click(()=>{
      $('input:checkbox[name=repomark]').prop('checked', false);
  });
  $("#download").click(()=>{
      location.href = document.URL + '/download'
  })
  var eventSourceUrl = document.URL + '/repos'
  var source = new EventSource(eventSourceUrl);

  source.addEventListener('repos', function(e) {
    var data = JSON.parse(e.data)
    var templateSource = $('#repos-template').html();
    var template = Handlebars.compile(templateSource);
    var repoList = template({repos: data});
    $('#repolist').html(repoList);
    $('#repocount').text('('+data.length+')')
    // repolist.append(data+'<br>')
    // attach triggers to the newly created buttons
    $("button[data-scan]").click(event => {
        // console.log("Click "+event.target)
        if (event.target.id == 'scan-all'){
          $("input:checkbox[name=repomark]:checked").each((i,v)=>{
            // console.log(v.id.substr(4))
            // todo
            // use async.queue with limited concurrency as to not overwhelm the server
            // https://caolan.github.io/async/docs.html
            startScan(v.id.substr(4))
          })
        } else if (event.target.id.indexOf('btn-')==0){
          if ($(event.target).text() == "Scan") {
            startScan(event.target.id.substr(4))
          } else if ($(event.target).text() == "Stop") {
            stopScan(event.target.id.substr(4))
          }
        }
    })
    e.target.close()
  }, false);

  function startScan(reponame){
    // console.log("Start "+reponame)
    $("#btn-"+$.escapeSelector(reponame)).text("Stop").toggleClass("active")
    var source = new EventSource(document.URL + '/'+reponame);
    // var zipbar = $('#zipbar-'+reponame.split('/')[0])
    // var scanbar = $('#scanbar-'+$.escapeSelector(reponame.split('/')[0]))
    // var results = $('#results-'+$.escapeSelector(reponame.split('/')[0]))
    var scanbar = $('#scanbar-'+$.escapeSelector(reponame))
    var results = $('#results-'+$.escapeSelector(reponame))
    source.addEventListener('zip', function(e) {
      // console.log(e.data)
      // console.log(typeof(e.data))
      if (e.data.indexOf('"broken"')==0){ //up this thing comes with quotes
        scanbar.css('width', '100%').attr('aria-valuenow', 100).addClass("progress-bar-striped").addClass("progress-bar-animated").removeClass("bg-secondary").addClass("bg-info")
        return
      }
      // var data = JSON.parse(e.data)
      // console.log(e)
      // console.log("zip "+e.data+"=>"+Math.ceil(e.data/100.0*90.0))
      // scanbar.css('width', Math.ceil(e.data/2.0)+'%').attr('aria-valuenow', Math.ceil(e.data/2.0));
      // first 90%
      scanbar.css('width', Math.ceil(e.data/100.0*90.0)+'%').attr('aria-valuenow', Math.ceil(e.data/100.0*90.0));
    }, false);

    source.addEventListener('scan', function(e) {
      // var data = JSON.parse(e.data)
      // console.log(e)
      // console.log("scan "+e.data+"=>"+Math.ceil(e.data/10+90.0))
      // scanbar.css('width', Math.ceil(e.data/2.0+50)+'%').attr('aria-valuenow', Math.ceil(e.data/2.0+50));
      // last 10%
      scanbar.css('width', Math.ceil(e.data/10+90.0)+'%').attr('aria-valuenow', Math.ceil(e.data/10.0+90.0));
    }, false);

    source.addEventListener('results', function(e) {
      // console.log(e)
      var d = JSON.parse(e.data)
      // dlang+" ("+repototal+") - "+JSON.stringify(klockbyext)+". "+extras.Other+" unknown files, "+extras.Tests+" test files, "+extras.Libs+" third party libs"
      if (typeof(d) !== 'string') {
        let r=[]
        for (x in d.ext){
          r.push(d.ext[x]+" "+x)
        }
        let f=[]
        if (d.other)
          f.push(`${d.other} <span data-toggle="tooltip" data-placement="top" title="Ignored files with unknown extensions">unknown</span> files`)
        if (d.tests)
          f.push(`${d.tests} <span data-toggle="tooltip" data-placement="top" title="Unit tests, functional test etc. that are not normally deployed to production">test</span> files`)
        if (d.libs)
          f.push(`${d.libs} <span data-toggle="tooltip" data-placement="top" title="Open source libraries (e.g. node modules) that shoud not, under most circuimstances, be analyzed">third party</span> libs`)
        results.html(`<span class="bold">${d.lang}</span> ${d.total} lines (${r.join(', ')}). ${f.join(', ')}`);
        $("#btn-"+$.escapeSelector(reponame)).text("").addClass("fa").addClass("fa-download").click(()=>{ location.href = document.URL + '/'+reponame+'/download'})
        $("#btn-"+$.escapeSelector(reponame)).toggleClass("active")
        $("#download").prop("disabled",false)
      } else {
        results.html('<span data-toggle="tooltip" data-placement="top" title="There are no files with known extensions">No compatible code</span>')
        $("#btn-"+$.escapeSelector(reponame)).text("").addClass("fa").addClass("fa-exclamation-triangle").prop("disabled",true)
      }
      $('[data-toggle="tooltip"]').tooltip() // a bit general, we could narrow it to just this result
      $('#progress-'+$.escapeSelector(reponame)).hide()
      $('#chk-'+$.escapeSelector(reponame)).prop('checked', false);
      results.show()
      source.close(); // we're done with results after the first and only message
    }, false);
    eventsources[document.URL + '/'+reponame]=source
  }

  function stopScan(reponame){
    $("#btn-"+$.escapeSelector(reponame)).text("Scan").toggleClass("active")
    // var source = new EventSource(document.URL + '/'+reponame);
    // we should do a get to stop the process on the server too
    eventsources[document.URL + '/'+reponame].close()
    var scanbar = $('#scanbar-'+$.escapeSelector(reponame))
    scanbar.css('width', '0%').attr('aria-valuenow', 0);
  }

})
